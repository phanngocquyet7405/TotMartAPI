jest.mock('../src/utils/sendEmail', () => jest.fn());
const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const app = require('../src/app');
const User = require('../src/models/User');
const passwords = require('../src/services/passwordService');
const identity = require('../src/services/userIdentityService');
const sendEmail = require('../src/utils/sendEmail');
const db = require('./helpers/db');
const { createUser, signToken } = require('./helpers/factories');
beforeAll(() => db.connect());
afterEach(async () => {
  jest.restoreAllMocks(); sendEmail.mockReset();
  // Isolate this suite's loopback client between test cases, not between requests.
  // The real limiter remains enabled; rateLimiter.test.js verifies the quota itself.
  const { ipKeyGenerator } = require('express-rate-limit');
  const { authLimiter } = require('../src/middleware/rateLimiter');
  await authLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
  await authLimiter.resetKey('127.0.0.1');
  await db.clearDatabase();
});
afterAll(db.closeDatabase);
const register = (email, name = 'Shared display', password = 'SyntheticPassword123!') => request(app).post('/api/users/register').send({ email, name, password });
const login = (email, password = 'SyntheticPassword123!') => request(app).post('/api/home/login').send({ email, password });
const forgot = email => request(app).post('/api/home/forgot-password').send({ email });
const tokenFrom = html => html.match(/reset-password\?token=([a-f0-9]{40})/)[1];
async function seedLegacy(email, password = 'SyntheticPassword123!', cost = 4) {
  const _id = new (require('mongoose').Types.ObjectId)();
  await User.collection.insertOne({ _id, name: 'Legacy fixture', email, password: await bcrypt.hash(password, cost), role: 'user', tokenVersion: 0, isActive: true });
  return User.findById(_id);
}

test('display names are not identities: duplicate name, canonical emails and concurrency', async () => {
  expect((await register(' First@Example.com ')).status).toBe(201);
  expect((await register('second@example.com')).status).toBe(201);
  expect(await User.countDocuments({ name: 'Shared display' })).toBe(2);
  expect((await User.findOne({ email: 'first@example.com' })).name).toBe('Shared display');
  const results = await Promise.all([register('RACE@example.com'), register(' race@EXAMPLE.COM ')]);
  expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  expect(await User.countDocuments({ email: 'race@example.com' })).toBe(1);
  expect((await register('third@example.com','ab')).status).toBe(400);
  expect((await register('third@example.com','x'.repeat(101))).status).toBe(400);
});

test('schema creation does not remove an old display unique index; registration reports migration pending instead of bad credentials', async () => {
  const indexName = await User.collection.createIndex({name:1},{unique:true,name:'b03_owned_legacy_display_fixture'});
  try {
    await User.createIndexes();
    expect((await User.collection.listIndexes().toArray()).some(i=>i.name===indexName&&i.unique)).toBe(true);
    expect((await register('legacy-index-one@example.com')).status).toBe(201);
    const blocked = await register('legacy-index-two@example.com');
    expect(blocked.status).toBe(503);
    expect(blocked.body.code).toBe('IDENTITY_MIGRATION_REQUIRED');
    expect((await login('legacy-index-one@example.com')).status).toBe(200);
  } finally {
    const actual = (await User.collection.listIndexes().toArray()).find(i=>i.name===indexName);
    if (!actual || actual.unique!==true || JSON.stringify(actual.key)!==JSON.stringify({name:1})) throw new Error('Owned fixture index changed; refusing cleanup');
    await User.collection.dropIndex(indexName); // Exact index created above on helper-owned disposable DB.
  }
});

test('legacy mixed/whitespace email remains unchanged and usable; new collision refused', async () => {
  const user = await seedLegacy(' Legacy.Mixed@Example.com ');
  expect((await login(user.email)).status).toBe(200);
  expect((await login('legacy.mixed@example.com')).status).toBe(200);
  expect((await User.findById(user._id)).email).toBe(user.email);
  expect((await register('LEGACY.MIXED@example.com','Another name')).status).toBe(409);
  sendEmail.mockResolvedValue({ success: true });
  expect((await forgot(' legacy.mixed@EXAMPLE.COM ')).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail.mock.calls[0][0]).toBe(user.email);
});

test('colliding legacy identities keep exact login; ambiguous canonical fallback never guesses accounts', async () => {
  await seedLegacy('Collision@Example.com');
  await seedLegacy('COLLISION@example.com','OtherSyntheticPassword!');
  expect((await login('Collision@Example.com')).status).toBe(200);
  expect((await login('COLLISION@example.com','OtherSyntheticPassword!')).status).toBe(200);
  expect((await login('Collision@Example.com','OtherSyntheticPassword!')).status).toBe(401);
  expect((await login('collision@example.com')).status).toBe(401);
  expect((await register('collision@example.com')).status).toBe(409);
  expect(await User.countDocuments()).toBe(2);
  expect(identity.canonicalEmail(' A+tag@Example.com ')).toBe('a+tag@example.com');
  expect((await register('a.b@example.com')).status).toBe(201);
  expect((await register('ab@example.com')).status).toBe(201);
});

test('admin uses existing profile update whitelist, can reuse display names, cannot inject email/password/role', async () => {
  const admin = (await createUser({ role: 'admin' })).user;
  const target = (await createUser()).user;
  const before = target.password;
  const response = await request(app).put(`/api/users/update-user/${target._id}`).set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ name: admin.name, email: 'forged@example.com', password: 'ForgedPassword!', role: 'admin' });
  expect(response.status).toBe(200);
  const saved = await User.findById(target._id);
  expect(saved.name).toBe(admin.name);
  expect(saved.email).toBe(target.email);
  expect(saved.password).toBe(before);
  expect(saved.role).toBe('user');
  const created = await request(app).post('/api/users/register').set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ name: admin.name, email: 'admin-created@example.com', password: 'SyntheticPassword123!', role: 'admin' });
  expect(created.status).toBe(201);
  expect(created.body.data.role).toBe('user');
});

test('model document/query email writers canonicalize, reject legacy collision and preserve non-email writes', async () => {
  const a = await seedLegacy(' Model.Legacy@Example.com '), b = (await createUser()).user;
  await expect(User.findByIdAndUpdate(b._id, { email: 'MODEL.LEGACY@example.com' })).rejects.toMatchObject({ code: 'EMAIL_CONFLICT' });
  await User.updateOne({ _id: b._id }, { $set: { email: ' Changed@Example.com ' } });
  expect((await User.findById(b._id)).email).toBe('changed@example.com');
  await User.updateOne({ _id: a._id }, { $set: { isActive: false } });
  expect((await User.findById(a._id)).email).toBe(a.email);
});

test('query-upsert used by the acceptance caller validates display name in query context', async () => {
  const hash = await bcrypt.hash('SyntheticPassword123!',4);
  const succeeded = await User.findOneAndUpdate({email:'upsert@example.com'}, {
    $set:{email:' Upsert@EXAMPLE.COM '},$setOnInsert:{name:'Upsert fixture',password:hash,role:'user'},
  },{upsert:true,new:true,runValidators:true}).then(()=>true,()=>false);
  expect(succeeded).toBe(true);
  expect((await User.findOne({email:'upsert@example.com'})).name).toBe('Upsert fixture');
  const rejected = await User.findOneAndUpdate({email:'upsert@example.com'},{$set:{name:'ab'}},{runValidators:true}).then(()=>false,()=>true);
  expect(rejected).toBe(true);
});

test('legacy hash verifies and upgrades; higher cost is retained', async () => {
  const old = await seedLegacy('old@example.com');
  expect((await login(old.email)).status).toBe(200);
  const saved = await User.findById(old._id);
  expect(bcrypt.getRounds(saved.password)).toBe(passwords.cost);
  expect(await bcrypt.compare('SyntheticPassword123!',saved.password)).toBe(true);
  const high = await seedLegacy('high@example.com','SyntheticPassword123!',passwords.cost+1);
  expect((await login(high.email)).status).toBe(200);
  expect((await User.findById(high._id)).password).toBe(high.password);
});

test('legacy-without-version can login, rehash and reset before any identity migration', async () => {
  const user = await seedLegacy('missing-version@example.com');
  await User.collection.updateOne({_id:user._id},{$unset:{tokenVersion:''}});
  const response = await login(user.email);
  expect(response.status).toBe(200);
  expect((await request(app).get('/api/users/me').set('Authorization',`Bearer ${response.body.token}`)).status).toBe(200);
  sendEmail.mockResolvedValue({success:true});
  expect((await forgot(user.email)).status).toBe(200);
  const token = tokenFrom(sendEmail.mock.calls[0][2]);
  expect((await request(app).post('/api/home/reset-password').send({token,password:'ReplacementPassword123!'})).status).toBe(200);
  expect((await User.findById(user._id)).tokenVersion).toBe(1);
  expect((await request(app).get('/api/users/me').set('Authorization',`Bearer ${response.body.token}`)).status).toBe(401);
});

test('supported legacy 2a hash verifies; well-formed Unicode including NUL is not normalized or silently cut', async () => {
  const user = await seedLegacy('prefix-legacy@example.com');
  await User.updateOne({_id:user._id},{$set:{password:user.password.replace('$2b$','$2a$')}});
  expect((await login(user.email)).status).toBe(200);
  const raw = 'Unicode\u0000value界123!';
  expect((await register('nul-unicode@example.com','Unicode fixture',raw)).status).toBe(201);
  expect((await login('nul-unicode@example.com',raw)).status).toBe(200);
  expect((await login('nul-unicode@example.com','Unicode')).status).toBe(401);
});

test('cost override has a security floor and can be tuned without assuming every host uses 12', async () => {
  const previous = process.env.BCRYPT_COST;
  try {
    process.env.BCRYPT_COST='9';
    expect(()=>jest.isolateModules(()=>require('../src/services/passwordService'))).toThrow('10 to 15');
    process.env.BCRYPT_COST='10';
    let configured;
    jest.isolateModules(()=>{configured=require('../src/services/passwordService');});
    expect(configured.cost).toBe(10);
    await configured.dummyHash;
  } finally {process.env.BCRYPT_COST=previous;}
});

test.each(['direct-change','reset'])('rehash cannot overwrite a concurrent %s or create a session with the old proof', async change => {
  const user = await seedLegacy('race-password@example.com');
  const originalHash = bcrypt.hash.bind(bcrypt);
  const replacement = await originalHash('ReplacementPassword123!',passwords.cost);
  const resetToken = crypto.randomBytes(20).toString('hex');
  await User.updateOne({ _id:user._id }, { $set: { resetPasswordToken: crypto.createHash('sha256').update(resetToken).digest('hex'), resetPasswordExpires:new Date(Date.now()+600000) } });
  let entered, release;
  const ready = new Promise(r=>{entered=r;}), gate = new Promise(r=>{release=r;});
  jest.spyOn(bcrypt,'hash').mockImplementation(async (...args) => {
    if(args[0]==='SyntheticPassword123!') { entered(); await gate; }
    return originalHash(...args);
  });
  const responsePromise = login(user.email).then(r=>r);
  await Promise.race([ready, responsePromise.then(r=>{ throw new Error('Login did not reach rehash gate, status '+r.status); })]);
  try {
    if(change==='reset') expect((await request(app).post('/api/home/reset-password').send({token:resetToken,password:'ReplacementPassword123!'})).status).toBe(200);
    else await User.updateOne({_id:user._id},{$set:{password:replacement}});
  } finally { release(); }
  expect((await responsePromise).status).toBe(401);
  const saved = await User.findById(user._id);
  expect(await bcrypt.compare('ReplacementPassword123!',saved.password)).toBe(true);
  expect(await require('../src/models/AuthSession').countDocuments({ userId:user._id })).toBe(0);
});

test('UTF-8 byte limit rejects new truncating passwords; legacy long input is explicitly flagged and not rehashed', async () => {
  expect((await register('unicode@example.com','Unicode fixture','界'.repeat(24))).status).toBe(201);
  expect((await register('too-long@example.com','Unicode fixture','界'.repeat(25))).status).toBe(400);
  expect((await register('ascii-long@example.com','Unicode fixture','a'.repeat(73))).status).toBe(400);
  const raw = 'a'.repeat(72)+'legacy-tail', legacy = await seedLegacy('long-legacy@example.com',raw);
  const result = await login(legacy.email,raw);
  expect(result.status).toBe(200);
  expect(result.body.passwordChangeRequired).toBe(true);
  expect((await User.findById(legacy._id)).password).toBe(legacy.password);
  expect((await login('unicode@example.com','界'.repeat(24))).status).toBe(200);
});

test('missing and wrong-password attempts use the process-level dummy; no per-request dummy hash generation', async () => {
  await passwords.dummyHash;
  const user = await seedLegacy('wrong@example.com');
  const hashing = jest.spyOn(bcrypt,'hash'), comparing = jest.spyOn(bcrypt,'compare');
  expect((await login('missing@example.com')).status).toBe(401);
  expect((await login(user.email,'WrongSyntheticPassword!')).status).toBe(401);
  expect(hashing).not.toHaveBeenCalled();
  expect(comparing).toHaveBeenCalledTimes(3); // one dummy; legacy compare plus dummy padding
});

test.each(['returned-failure','thrown-failure'])('forgot response is public and old %s cannot erase a newer token', async mode => {
  const user = await seedLegacy('forgot-race@example.com');
  let entered, release;
  const ready = new Promise(r=>{entered=r;}), gate = new Promise(r=>{release=r;});
  sendEmail.mockImplementationOnce(async()=>{ entered(); await gate; if(mode==='thrown-failure') throw new Error('Synthetic provider failure'); return {success:false}; })
    .mockResolvedValueOnce({success:true});
  const old = forgot(user.email).then(r=>r);
  await Promise.race([ready, old.then(r=>{ throw new Error('Forgot did not reach delivery gate, status '+r.status); })]);
  const newer = await forgot(user.email), saved = await User.findById(user._id);
  release();
  const failed = await old, absent = await forgot('absent@example.com');
  expect(failed.status).toBe(200); expect(newer.status).toBe(200); expect(absent.status).toBe(200);
  expect(failed.body).toEqual(absent.body); expect(newer.body).toEqual(absent.body);
  expect((await User.findById(user._id)).resetPasswordToken).toBe(saved.resetPasswordToken);
});

test('reset preserves higher cost, rejects new over-byte passwords, expires and consumes once', async () => {
  const user = await seedLegacy('reset-high@example.com','SyntheticPassword123!',passwords.cost+1);
  sendEmail.mockResolvedValue({success:true}); await forgot(user.email);
  const token = tokenFrom(sendEmail.mock.calls[0][2]);
  expect((await request(app).post('/api/home/reset-password').send({token,password:'界'.repeat(25)})).status).toBe(400);
  const responses = await Promise.all(Array.from({length:2},()=>request(app).post('/api/home/reset-password').send({token,password:'ResetPassword123!'})));
  expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
  expect(bcrypt.getRounds((await User.findById(user._id)).password)).toBe(passwords.cost+1);
  await forgot(user.email);
  const expired = tokenFrom(sendEmail.mock.calls[1][2]);
  await User.updateOne({_id:user._id},{$set:{resetPasswordExpires:new Date(0)}});
  expect((await request(app).post('/api/home/reset-password').send({token:expired,password:'ResetPassword123!'})).status).toBe(400);
});

test('reset checks expiry at the write even if transaction admission is delayed past the deadline', async () => {
  const user = await seedLegacy('expiry-admission@example.com');
  const token = crypto.randomBytes(20).toString('hex'), deadline = Date.now()+1500;
  await User.updateOne({_id:user._id},{$set:{resetPasswordToken:crypto.createHash('sha256').update(token).digest('hex'),resetPasswordExpires:new Date(deadline)}});
  const connection = require('mongoose').connection, original = connection.transaction.bind(connection);
  jest.spyOn(connection,'transaction').mockImplementationOnce(async (...args)=>{
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now()+150)));
    return original(...args);
  });
  const response = await request(app).post('/api/home/reset-password').send({token,password:'ReplacementPassword123!'});
  expect(response.status).toBe(400);
  expect((await User.findById(user._id)).tokenVersion).toBe(0);
});
