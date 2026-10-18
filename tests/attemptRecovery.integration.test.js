const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, createBrand, createProduct, createCartWithItems, signToken } = require('./helpers/factories');
const attempts = require('../src/services/checkoutAttemptService');
const { requestHash } = require('../src/services/checkoutLifecycle');
const Attempt = require('../src/models/CheckoutAttempt');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Box = require('../src/models/Box');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
const auth = user => ({ Authorization: `Bearer ${signToken(user)}` });
const key = 'recovery-behavior-key-123';
async function fixture() {
  const { user } = await createUser(); const brand = await createBrand(); const product = await createProduct(brand);
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
  return { user, brand, product, body: { addressId: String(user.addresses[0]._id), paymentMethod: 'cod' } };
}
const send = (user, body) => request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key', key).send(body);
test('snapshot survives an address edit before commit; response loss replays without consuming stock twice', async () => {
  const { user, body, product } = await fixture();
  await attempts.prepare(user._id, 'products', key, requestHash(body), body);
  await User.updateOne({ _id: user._id }, { $set: { 'addresses.0.address': 'Changed after prepare' } });
  const first = await send(user, body); expect(first.status).toBe(201);
  expect((await Order.findOne()).shippingAddress.address).toBe(user.addresses[0].address);
  const retry = await send(user, body); expect(retry.body).toEqual(first.body);
  expect((await require('../src/models/Product').findById(product._id)).stock).toBe(9);
  expect((await attempts.resolve(user._id, 'products', key, requestHash(body), true)).canRestart).toBe(false);
});
test('unknown is inconclusive; termination installs tombstone for requests arriving late', async () => {
  const { user, body } = await fixture(), hash = requestHash(body);
  expect(await attempts.resolve(user._id, 'products', key, hash)).toEqual({ state: 'unknown', canRestart: false });
  expect((await attempts.resolve(user._id, 'products', key, hash, true)).canRestart).toBe(true);
  expect((await send(user, body)).status).toBe(409); expect(await Order.countDocuments()).toBe(0);
});
test('in-flight transaction and termination serialize on the attempt', async () => {
  const { user, body } = await fixture(), hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  const results = await Promise.all([send(user, body), attempts.resolve(user._id, 'products', key, hash, true)]);
  const attempt = await Attempt.findOne();
  if (attempt.state === 'created') { expect(results[1].canRestart).toBe(false); expect(await Order.countDocuments()).toBe(1); }
  else { expect(attempt.state).toBe('invalidated'); expect(await Order.countDocuments()).toBe(0); }
});
test('payload conflict and another user cannot access or mutate the attempt', async () => {
  const { user, body } = await fixture(), { user: other } = await createUser(), hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  await expect(attempts.prepare(user._id, 'products', key, requestHash({ ...body, note: 'different' }), body)).rejects.toMatchObject({ code: 'ATTEMPT_PAYLOAD_MISMATCH' });
  const response = await request(app).get(`/api/checkout/attempts/products/${key}`).set(auth(other)).set('Attempt-Payload-Hash', hash);
  expect(response.body.data.state).toBe('unknown');
  expect((await Attempt.findOne({ userId: user._id })).state).toBe('processing');
});
test('legacy committed checkout replays even without attempt; addressHash rejects stale selection', async () => {
  const { user, body } = await fixture(); const first = await send(user, body); expect(first.status).toBe(201);
  await Attempt.deleteMany({}); expect((await send(user, body)).body).toEqual(first.body);
  await expect(attempts.prepare(user._id, 'products', 'another-recovery-key-123', requestHash(body), { ...body, addressHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'ADDRESS_CHANGED' });
});
test('admin creation stores verified owner and rejects the entire invalid composition', async () => {
  const { brand, product } = await fixture(), { user: admin } = await createUser({ role: 'admin' });
  const body = { ownerId: String(brand.ownerId), name: 'Admin combo', descriptions: 'Combo', stock: 4, validTo: new Date(Date.now() + 86400000).toISOString(), discountPercent: 12.5, products: [{ productId: String(product._id), quantity: 1 }] };
  const post = payload => request(app).post('/api/boxes/create-box').set(auth(admin)).send(payload);
  async function create(payload) { const response = await post(payload); return response.status === 201 ? { data: response.body } : { error: response.body }; }
  const good = await create(body); expect(good.error).toBeUndefined(); expect(String(good.data.data.ownerId)).toBe(String(brand.ownerId)); expect(good.data.data.value).toBe(87500);
  for (const parts of [[...body.products, ...body.products], [{ productId: new mongoose.Types.ObjectId(), quantity: 1 }], [{ productId: product._id, quantity: 0 }]]) {
    expect((await create({ ...body, products: parts })).error).toBeTruthy();
  }
  const foreign = await createProduct(await createBrand());
  expect((await create({ ...body, products: [{ productId: foreign._id, quantity: 1 }] })).error).toBeTruthy();
  await require('../src/models/Product').updateOne({ _id: product._id }, { $set: { archivedAt: new Date() } });
  expect((await create(body)).error).toBeTruthy(); expect(await Box.countDocuments()).toBe(1);
});
test('terminal rejection is durable; a new attempt needs explicit termination', async () => {
  const { user, body } = await fixture(), hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  await attempts.reject(user._id, 'products', key, hash, Object.assign(new Error('bad quote'), { statusCode: 409 }));
  expect((await send(user, body)).status).toBe(409);
  expect((await attempts.resolve(user._id, 'products', key, hash)).state).toBe('rejected');
  expect((await attempts.resolve(user._id, 'products', key, hash, true)).canRestart).toBe(true);
  expect(await Order.countDocuments()).toBe(0);
});
test('subscription tombstone rejects late subscribe before template or payment writes', async () => {
  const { user } = await fixture();
  const raw = { templateId: String(new mongoose.Types.ObjectId()), shippingAddress: { address: '123 Main street', district: 'District', city: 'City', country: 'VN', phone: '0900000000' } };
  const { value, error } = require('../src/middleware/validationSchemas').subscribeToTemplateSchema.validate(raw);
  expect(error).toBeUndefined();
  await attempts.resolve(user._id, 'subscription', key, requestHash(value), true);
  const response = await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(user)).set('Idempotency-Key', key).send(raw);
  expect(response.status).toBe(409); expect(await require('../src/models/UserSubscription').countDocuments()).toBe(0);
});
test('migration is dry by default, reports flag conflicts, and supports CAS rollback', async () => {
  const { brand, product } = await fixture();
  const box = await Box.create({ ownerId: brand.ownerId, name: 'Legacy flags', descriptions: 'Legacy', stock: 1, value: 100000, validFrom: new Date(), validTo: new Date(Date.now() + 86400000), products: [{ productId: product._id, quantity: 1 }] });
  await Box.collection.updateOne({ _id: box._id }, { $unset: { subscriptionOnly: '' }, $set: { internalSubscription: true } });
  const migration = require('../scripts/migrate-commerce-integrity'); const report = await migration.plan();
  expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBeUndefined();
  expect(report.changes.some(c => c.id === String(box._id))).toBe(true);
  await migration.apply(report); expect((await Box.findById(box._id)).subscriptionOnly).toBe(true);
  await migration.apply(report, true); expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBeNull();
  await Box.collection.updateOne({ _id: box._id }, { $set: { subscriptionOnly: false } });
  expect((await migration.plan()).conflicts.some(c => c.id === String(box._id))).toBe(true);
});
test('termination waits for a request already holding the attempt write fence', async () => {
  const { user, body } = await fixture(), hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  const realLock = attempts.lock;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const locked = new Promise(resolve => { entered = resolve; });
  const spy = jest.spyOn(attempts, 'lock').mockImplementation(async (...args) => {
    const result = await realLock(...args); entered(); await gate; return result;
  });
  try {
    const creation = send(user, body).then(response => response);
    await locked;
    const termination = attempts.resolve(user._id, 'products', key, hash, true);
    await new Promise(resolve => setImmediate(resolve));
    release();
    expect((await creation).status).toBe(201);
    expect((await termination).canRestart).toBe(false);
    expect(await Order.countDocuments()).toBe(1);
  } finally { release(); spy.mockRestore(); }
});
test('admin cleans successful image uploads if a later upload or creation fails', async () => {
  const cloud = require('cloudinary').v2.uploader, { Writable } = require('node:stream');
  let calls = 0;
  const upload = jest.spyOn(cloud, 'upload_stream').mockImplementation((options, callback) => new Writable({
    write(chunk, encoding, done) { done(); },
    final(done) { calls++; callback(calls === 2 ? new Error('Synthetic admin upload failure') : null, { secure_url: 'https://test.invalid/image.webp', public_id: 'admin-image' }); done(); },
  }));
  const destroy = jest.spyOn(cloud, 'destroy').mockResolvedValue({ result: 'ok' });
  try {
    const next = jest.fn();
    await require('../src/controllers/boxController').createBox({ validatedBody: {}, files: [{ buffer: Buffer.from('fixture') }, { buffer: Buffer.from('fixture') }] }, {}, next);
    expect(next).toHaveBeenCalled(); expect(destroy).toHaveBeenCalledWith('admin-image'); expect(await Box.countDocuments()).toBe(0);
    calls = 0; next.mockClear(); destroy.mockClear();
    await require('../src/controllers/boxController').createBox({ validatedBody: { ownerId: new mongoose.Types.ObjectId(), products: [] }, files: [{ buffer: Buffer.from('fixture') }] }, {}, next);
    expect(next).toHaveBeenCalled(); expect(destroy).toHaveBeenCalledWith('admin-image'); expect(await Box.countDocuments()).toBe(0);
  } finally { upload.mockRestore(); destroy.mockRestore(); }
});
