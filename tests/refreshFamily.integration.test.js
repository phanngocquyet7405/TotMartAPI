const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Session = require('../src/models/AuthSession');
const Outbox = require('../src/models/SecurityOutbox');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken } = require('./helpers/factories');
const service = require('../src/services/sessionService');
beforeAll(() => connect({ mongoArgs: ['--setParameter', 'ttlMonitorSleepSecs=1'] }));
beforeEach(async () => {
  // Isolate scenarios, never reset quota between requests within a scenario.
  const { authLimiter } = require('../src/middleware/rateLimiter');
  await authLimiter.resetKey(require('express-rate-limit').ipKeyGenerator('::ffff:127.0.0.1'));
  await authLimiter.resetKey('127.0.0.1');
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDatabase();
});
afterAll(closeDatabase);
const cookie = (response) =>
  response.headers['set-cookie'].find((value) => value.startsWith('refreshToken=')).split(';')[0];
const refresh = (value) =>
  request(app).post('/api/home/refresh').set('Cookie', value).set('X-TotMart-Request', '1');
async function login(user, password) {
  const response = await request(app).post('/api/home/login').send({ email: user.email, password });
  expect(response.status).toBe(200);
  return response;
}
test('concurrency and repeated service calls recover same successor with durable retry budget', async () => {
  const { user, plainPassword } = await createUser();
  const original = cookie(await login(user, plainPassword));
  const [a, b] = await Promise.all([refresh(original), refresh(original)]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(cookie(a) === cookie(b)).toBe(true);
  // Same-process retry; actual restart is covered by subprocess/real-Redis HTTP drills.
  const recovered = await require('../src/services/sessionService').rotate(
    original.slice('refreshToken='.length),
  );
  expect(Boolean(recovered)).toBe(true);
  expect(
    service.hash(recovered.refresh) === service.hash(cookie(a).slice('refreshToken='.length)),
  ).toBe(true);
  const saved = await Session.findOne();
  expect(saved.history[0].retries).toBe(2);
  expect(JSON.stringify(saved).includes(recovered.refresh)).toBe(false);
  expect((await refresh(original)).status).toBe(401);
  expect(Boolean((await Session.findOne()).revokedAt)).toBe(true);
  expect(await Outbox.countDocuments({ reason: 'refresh_reuse_or_limit' })).toBe(1);
});
test('4095 to 4096 retains every hash, permits bounded last retry, then rejects further rotation', async () => {
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword);
  const sid = jwt.decode(initial.body.token).sid;
  const family = await Session.findOne({ sessionId: sid });
  const expiresAt = family.expiresAt.getTime();
  const history = Array.from({ length: 4095 }, (_, index) => ({
    hash: service.hash(`boundary-${index}`),
    consumedAt: new Date(),
    retries: 0,
  }));
  await Session.updateOne({ _id: family._id }, { $set: { history } });
  const last = await refresh(cookie(initial));
  expect(last.status).toBe(200);
  const full = await Session.findById(family._id);
  expect(full.history.length).toBe(4096);
  expect(
    full.history.slice(0, 4095).every((entry, index) => entry.hash === history[index].hash),
  ).toBe(true);
  expect(
    full.history[4095].hash === service.hash(cookie(initial).slice('refreshToken='.length)),
  ).toBe(true);
  expect(full.expiresAt.getTime()).toBe(expiresAt);
  const retry = await refresh(cookie(initial));
  expect(retry.status).toBe(200);
  expect(cookie(retry) === cookie(last)).toBe(true);
  expect((await refresh(cookie(last))).status).toBe(401);
  const revoked = await Session.findById(family._id);
  expect(revoked.history.length).toBe(4096);
  expect(revoked.expiresAt.getTime()).toBe(expiresAt);
  expect(Boolean(revoked.revokedAt)).toBe(true);
  expect((await refresh(cookie(initial))).status).toBe(401);
});
test('actual lookup/TTL indexes exist and TTL eventually cleans a logically expired family', async () => {
  const indexes = await Session.collection.indexes();
  expect(indexes.some((index) => index.key.sessionId === 1 && index.unique)).toBe(true);
  expect(indexes.some((index) => index.key.refreshHash === 1 && index.unique)).toBe(true);
  expect(indexes.some((index) => index.key['history.hash'] === 1)).toBe(true);
  expect(indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(
    true,
  );
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword);
  const sid = jwt.decode(initial.body.token).sid,
    expiresAt = new Date(Date.now() + 1500);
  await Session.updateOne({ sessionId: sid }, { expiresAt });
  expect((await refresh(cookie(initial))).status).toBe(200);
  expect((await Session.findOne({ sessionId: sid })).expiresAt.getTime()).toBe(expiresAt.getTime());
  const deadline = Date.now() + 10000;
  while (await Session.exists({ sessionId: sid })) {
    if (Date.now() > deadline) throw new Error('Disposable TTL cleanup deadline exceeded');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect((await refresh(cookie(initial))).status).toBe(401);
});
test('late reuse durably denies access/refresh for that family and preserves another device', async () => {
  const { user, plainPassword } = await createUser();
  const first = await login(user, plainPassword),
    other = await login(user, plainPassword);
  const old = cookie(first),
    next = await refresh(old);
  const sid = jwt.decode(first.body.token).sid;
  await Session.updateOne(
    { sessionId: sid },
    { $set: { 'history.0.consumedAt': new Date(Date.now() - 30001) } },
  );
  expect((await refresh(old)).status).toBe(401);
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${next.body.token}`))
      .status,
  ).toBe(401);
  expect((await refresh(cookie(next))).status).toBe(401);
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${other.body.token}`))
      .status,
  ).toBe(200);
  expect((await refresh(cookie(other))).status).toBe(200);
});
test('ancestor cannot roll back an advanced successor; unknown tokens cannot revoke a family', async () => {
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword),
    next = await refresh(cookie(initial));
  expect((await refresh(`refreshToken=${'a'.repeat(96)}`)).status).toBe(401);
  expect(await Session.countDocuments({ revokedAt: { $exists: true } })).toBe(0);
  expect((await refresh(cookie(next))).status).toBe(200);
  expect((await refresh(cookie(initial))).status).toBe(401);
});
test('logical expiry denies access and refresh before TTL cleanup', async () => {
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword);
  await Session.updateOne({}, { expiresAt: new Date(Date.now() - 1) });
  expect((await refresh(cookie(initial))).status).toBe(401);
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${initial.body.token}`))
      .status,
  ).toBe(401);
});
test('staging requires sid at HTTP entrypoints, including admin, and retains profile claims', async () => {
  const { user, plainPassword } = await createUser({ role: 'admin' });
  const initial = await login(user, plainPassword);
  const decoded = jwt.decode(initial.body.token);
  expect(decoded.name === user.name && decoded.email === user.email).toBe(true);
  jest.spyOn(require('../src/config/sessionPolicy'), 'strictSessions').mockReturnValue(true);
  for (const path of ['/api/users/me', '/api/admin/notifications/stream-ticket']) {
    expect(
      (
        await request(app)
          .get(path)
          .set('Authorization', `Bearer ${signToken(user)}`)
      ).status,
    ).toBe(401);
  }
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${initial.body.token}`))
      .status,
  ).toBe(200);
});
test('recovery survives actual separate Node processes without storing raw credentials', async () => {
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword),
    rotated = await refresh(cookie(initial));
  const digest = service.hash(cookie(rotated).slice('refreshToken='.length));
  const { spawn } = require('child_process');
  const uri = require('mongoose').connection.getClient().s.url;
  async function worker() {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [require('path').join(__dirname, 'helpers/refresh-child.js')],
        {
          env: {
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            JWT_SECRET: process.env.JWT_SECRET,
            JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
          },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 15000,
        },
      );
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(JSON.parse(output)) : reject(new Error('Recovery worker failed')),
      );
      child.stdin.end(
        JSON.stringify({ uri, refresh: cookie(initial).slice('refreshToken='.length) }),
      );
    });
  }
  expect(await worker()).toEqual({ accepted: true, digest });
  expect(await worker()).toEqual({ accepted: true, digest });
  expect((await refresh(cookie(initial))).status).toBe(401);
});
test('reuse outbox failure rolls back revocation; history admission cap never discards hashes', async () => {
  const { user, plainPassword } = await createUser();
  const initial = await login(user, plainPassword);
  await refresh(cookie(initial));
  await Session.updateOne({}, { $set: { 'history.0.retries': 2 } });
  const failed = jest
    .spyOn(Outbox, 'create')
    .mockRejectedValueOnce(new Error('fixture write failure'));
  try {
    await expect(service.rotate(cookie(initial).slice('refreshToken='.length))).rejects.toThrow(
      'fixture write failure',
    );
  } finally {
    failed.mockRestore();
  }
  expect(await Session.countDocuments({ revokedAt: { $exists: true } })).toBe(0);
  const family = await Session.findOne();
  const history = Array.from({ length: 4096 }, (_, index) => ({
    hash: service.hash(`fixture-${index}`),
    consumedAt: new Date(),
    retries: 0,
  }));
  const current = 'b'.repeat(96);
  await Session.updateOne(
    { _id: family._id },
    { $set: { history, refreshHash: service.hash(current) } },
  );
  expect(await service.rotate(current)).toBeNull();
  const saved = await Session.findById(family._id);
  expect(saved.history.length).toBe(4096);
  expect(Boolean(saved.revokedAt)).toBe(true);
});
test('family revocation closes only its SSE; missed signals fall back to heartbeat DB checks', async () => {
  const { user, plainPassword } = await createUser({ role: 'admin' });
  const first = await login(user, plainPassword),
    second = await login(user, plainPassword);
  const controller = require('../src/controllers/notificationController');
  const { issueSseTicket } = require('../src/utils/notify');
  const { EventEmitter } = require('events');
  const callbacks = [];
  const intervals = jest.spyOn(global, 'setInterval').mockImplementation((callback) => {
    callbacks.push(callback);
    return undefined;
  });
  async function open(token) {
    const decoded = jwt.decode(token),
      res = new EventEmitter();
    res.writeHead = jest.fn();
    res.write = jest.fn();
    res.end = jest.fn(() => {
      res.writableEnded = true;
      res.emit('close');
    });
    res.status = jest.fn(() => res);
    res.json = jest.fn();
    await controller.streamNotifications(
      {
        query: {
          ticket: issueSseTicket(user._id, {
            sid: decoded.sid,
            tokenVersion: decoded.tokenVersion,
          }),
        },
      },
      res,
      (error) => {
        throw error;
      },
    );
    expect(res.writeHead).toHaveBeenCalled();
    return res;
  }
  try {
    const a = await open(first.body.token),
      b = await open(second.body.token);
    intervals.mockRestore();
    await refresh(cookie(first));
    await Session.updateOne(
      { sessionId: jwt.decode(first.body.token).sid },
      { $set: { 'history.0.retries': 2 } },
    );
    await refresh(cookie(first));
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(b.end).not.toHaveBeenCalled();
    // Simulate durable revocation committed elsewhere with no Pub/Sub signal.
    await Session.updateOne(
      { sessionId: jwt.decode(second.body.token).sid },
      { revokedAt: new Date() },
    );
    await callbacks[1]();
    expect(b.end).toHaveBeenCalledTimes(1);
    jest.spyOn(require('../src/config/sessionPolicy'), 'strictSessions').mockReturnValue(true);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.streamNotifications(
      { query: { ticket: issueSseTicket(user._id, { tokenVersion: user.tokenVersion }) } },
      res,
      (error) => {
        throw error;
      },
    );
    expect(res.status).toHaveBeenCalledWith(401);
  } finally {
    intervals.mockRestore();
    controller.terminateUserStreams(user._id);
  }
});
