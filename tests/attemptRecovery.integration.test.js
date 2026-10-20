const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const {
  createUser,
  createBrand,
  createProduct,
  createCartWithItems,
  signToken,
} = require('./helpers/factories');
const attempts = require('../src/services/checkoutAttemptService');
const { requestHash } = require('../src/services/checkoutLifecycle');
const Attempt = require('../src/models/CheckoutAttempt');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Box = require('../src/models/Box');
const { assertResponse } = require('./helpers/apiContract');
beforeAll(connect);
afterEach(clearDatabase);
afterAll(closeDatabase);
const auth = (user) => ({ Authorization: `Bearer ${signToken(user)}` });
const key = 'recovery-behavior-key-123';
async function fixture() {
  const { user } = await createUser();
  const brand = await createBrand();
  const product = await createProduct(brand);
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
  return {
    user,
    brand,
    product,
    body: { addressId: String(user.addresses[0]._id), paymentMethod: 'cod' },
  };
}
const send = (user, body) =>
  request(app)
    .post('/api/checkout/check-out')
    .set(auth(user))
    .set('Idempotency-Key', key)
    .send(body);
const prepareHttp = (user, body) =>
  request(app)
    .post('/api/checkout/attempts/products/prepare')
    .set(auth(user))
    .set('Idempotency-Key', key)
    .send(body);
const terminateBody = (user, body) =>
  request(app)
    .post(`/api/checkout/attempts/products/${key}/terminate-with-body`)
    .set(auth(user))
    .send(body);
test('durable admission cap serializes two new keys but preserves recovery for an existing key', async () => {
  const { user, body } = await fixture();
  await Attempt.collection.insertMany(
    Array.from({ length: 9999 }, (_, i) => ({
      userId: user._id,
      kind: 'products',
      key: 'capacity-fixture-' + i,
      hash: requestHash(body),
      state: 'invalidated',
    })),
  );
  const results = await Promise.all(
    [key, 'capacity-other-key-1234'].map((reference) =>
      request(app)
        .post(`/api/checkout/attempts/products/${reference}/terminate-with-body`)
        .set(auth(user))
        .send(body),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
  expect(await Attempt.countDocuments({ userId: user._id })).toBe(10000);
  const admitted = results.find((r) => r.status === 200).body.data.key;
  expect(
    (
      await request(app)
        .post(`/api/checkout/attempts/products/${admitted}/terminate-with-body`)
        .set(auth(user))
        .send(body)
    ).body.data.canRestart,
  ).toBe(true);
  expect(
    (
      await request(app)
        .post(`/api/checkout/attempts/products/capacity-third-key-1234/terminate-with-body`)
        .set(auth(user))
        .send(body)
    ).body.code,
  ).toBe('ATTEMPT_CAPACITY_REACHED');
});
test.each(['ADDRESS_NOT_FOUND', 'ADDRESS_CHANGED'])(
  'HTTP pre-hash %s can be fenced then corrected with a new key',
  async (code) => {
    const { user, body, product } = await fixture();
    const stale =
      code === 'ADDRESS_NOT_FOUND'
        ? { ...body, addressId: String(new mongoose.Types.ObjectId()) }
        : { ...body, addressHash: '0'.repeat(64) };
    expect((await prepareHttp(user, stale)).body.code).toBe(code);
    expect(await Attempt.countDocuments()).toBe(0);
    const ended = await terminateBody(user, stale);
    expect(ended.status).toBe(200);
    expect(ended.body.data).toMatchObject({ state: 'invalidated', canRestart: true });
    expect((await send(user, stale)).status).toBe(409);
    const fresh = await request(app)
      .post('/api/checkout/check-out')
      .set(auth(user))
      .set('Idempotency-Key', 'corrected-reference-12345')
      .send(body);
    expect(fresh.status).toBe(201);
    expect(await Order.countDocuments()).toBe(1);
    expect((await require('../src/models/Product').findById(product._id)).stock).toBe(9);
  },
);
test('HTTP invalid payload never writes a tombstone; lost prepare response recovers hash using validated body', async () => {
  const { user, body } = await fixture();
  expect((await terminateBody(user, { ...body, paymentMethod: 'invalid' })).status).toBe(400);
  expect(await Attempt.countDocuments()).toBe(0);
  const prepared = await prepareHttp(user, body);
  expect(prepared.status).toBe(200);
  await assertResponse('/checkout/attempts/products/prepare', 'post', prepared);
  const ended = await terminateBody(user, body);
  await assertResponse('/checkout/attempts/products/{key}/terminate-with-body', 'post', ended);
  expect(ended.body.data.hash).toBe(prepared.body.data.hash);
  expect(ended.body.data.canRestart).toBe(true);
  expect((await send(user, body)).status).toBe(409);
  expect(await Order.countDocuments()).toBe(0);
});
test('body recovery hashes subscription conversions, defaults and stripped unknown fields exactly like prepare', async () => {
  const { user } = await fixture();
  const raw = {
    templateId: String(new mongoose.Types.ObjectId()),
    expectedTotalAmount: '600000',
    ignored: 'strip me',
    shippingAddress: {
      address: 'Street',
      district: 'District',
      city: 'City',
      country: 'VN',
      phone: '0900000000',
    },
  };
  const prepared = await request(app)
    .post('/api/checkout/attempts/subscription/prepare')
    .set(auth(user))
    .set('Idempotency-Key', key)
    .send(raw);
  expect(prepared.status).toBe(200);
  const ended = await request(app)
    .post(`/api/checkout/attempts/subscription/${key}/terminate-with-body`)
    .set(auth(user))
    .send(raw);
  expect(ended.status).toBe(200);
  expect(ended.body.data.hash).toBe(prepared.body.data.hash);
  const { value, error } =
    require('../src/middleware/validationSchemas').subscribeToTemplateSchema.validate(raw, {
      stripUnknown: true,
    });
  expect(error).toBeUndefined();
  expect(value.expectedTotalAmount).toBe(600000);
  expect(value.shippingAddress.zipCode).toBe('');
  expect(value.ignored).toBeUndefined();
  expect(ended.body.data.hash).toBe(requestHash(value));
  expect(ended.body.data.canRestart).toBe(true);
});
test('HTTP body termination races create and preserves exactly one terminal outcome', async () => {
  const { user, body } = await fixture();
  expect((await prepareHttp(user, body)).status).toBe(200);
  const [created, ended] = await Promise.all([send(user, body), terminateBody(user, body)]);
  expect(ended.status).toBe(200);
  if (ended.body.data.state === 'created') {
    expect(created.status).toBe(201);
    expect(ended.body.data.canRestart).toBe(false);
    expect(await Order.countDocuments()).toBe(1);
  } else {
    expect(ended.body.data.state).toBe('invalidated');
    expect(created.status).toBe(409);
    expect(await Order.countDocuments()).toBe(0);
  }
});
test('HTTP separate purchases replay old results without consuming the new cart', async () => {
  const { user, body, product } = await fixture();
  const first = await send(user, body);
  expect(first.status).toBe(201);
  const Cart = require('../src/models/Cart');
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);
  expect((await send(user, body)).body).toEqual(first.body);
  expect((await Cart.findOne({ userId: user._id })).items[0].quantity).toBe(2);
  const second = await request(app)
    .post('/api/checkout/check-out')
    .set(auth(user))
    .set('Idempotency-Key', 'second-purchase-key-1234')
    .send(body);
  expect(second.status).toBe(201);
  expect(second.body.data.orderId).not.toBe(first.body.data.orderId);
  const ended = await terminateBody(user, body);
  await assertResponse('/checkout/attempts/products/{key}/terminate-with-body', 'post', ended);
  expect(ended.body.data).toMatchObject({
    state: 'created',
    canRestart: false,
    result: first.body.data,
  });
  expect((await send(user, body)).body).toEqual(first.body);
  expect(await Order.countDocuments()).toBe(2);
  expect((await require('../src/models/Product').findById(product._id)).stock).toBe(7);
});
test('attempt lookup and termination responses enforce the documented recovery envelope', async () => {
  const { user, body } = await fixture();
  const url = `/api/checkout/attempts/products/${key}`;
  const unknown = await request(app)
    .get(url)
    .set(auth(user))
    .set('Attempt-Payload-Hash', requestHash(body));
  expect(unknown.status).toBe(200);
  await assertResponse('/checkout/attempts/{kind}/{key}', 'get', unknown);
  expect(unknown.body.data).toEqual({ state: 'unknown', canRestart: false });
  const ended = await request(app)
    .post(`${url}/terminate`)
    .set(auth(user))
    .set('Attempt-Payload-Hash', requestHash(body));
  expect(ended.status).toBe(200);
  await assertResponse('/checkout/attempts/{kind}/{key}/terminate', 'post', ended);
  expect(ended.body.data).toMatchObject({ state: 'invalidated', canRestart: true });
  const mismatch = await request(app)
    .get(url)
    .set(auth(user))
    .set('Attempt-Payload-Hash', 'f'.repeat(64));
  expect(mismatch.status).toBe(409);
  await assertResponse('/checkout/attempts/{kind}/{key}', 'get', mismatch);
  expect(mismatch.body.code).toBe('ATTEMPT_PAYLOAD_MISMATCH');
  const invalid = await request(app).get(url).set(auth(user));
  expect(invalid.status).toBe(400);
  await assertResponse('/checkout/attempts/{kind}/{key}', 'get', invalid);
  expect(await Order.countDocuments()).toBe(0);
});
test('snapshot survives an address edit before commit; response loss replays without consuming stock twice', async () => {
  const { user, body, product } = await fixture();
  await attempts.prepare(user._id, 'products', key, requestHash(body), body);
  await User.updateOne(
    { _id: user._id },
    { $set: { 'addresses.0.address': 'Changed after prepare' } },
  );
  const first = await send(user, body);
  expect(first.status).toBe(201);
  expect((await Order.findOne()).shippingAddress.address).toBe(user.addresses[0].address);
  const retry = await send(user, body);
  expect(retry.body).toEqual(first.body);
  expect((await require('../src/models/Product').findById(product._id)).stock).toBe(9);
  expect(
    (await attempts.resolve(user._id, 'products', key, requestHash(body), true)).canRestart,
  ).toBe(false);
});
test('unknown is inconclusive; termination installs tombstone for requests arriving late', async () => {
  const { user, body } = await fixture(),
    hash = requestHash(body);
  expect(await attempts.resolve(user._id, 'products', key, hash)).toEqual({
    state: 'unknown',
    canRestart: false,
  });
  expect((await attempts.resolve(user._id, 'products', key, hash, true)).canRestart).toBe(true);
  expect((await send(user, body)).status).toBe(409);
  expect(await Order.countDocuments()).toBe(0);
});
test('in-flight transaction and termination serialize on the attempt', async () => {
  const { user, body } = await fixture(),
    hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  const results = await Promise.all([
    send(user, body),
    attempts.resolve(user._id, 'products', key, hash, true),
  ]);
  const attempt = await Attempt.findOne();
  if (attempt.state === 'created') {
    expect(results[1].canRestart).toBe(false);
    expect(await Order.countDocuments()).toBe(1);
  } else {
    expect(attempt.state).toBe('invalidated');
    expect(await Order.countDocuments()).toBe(0);
  }
});
test('payload conflict and another user cannot access or mutate the attempt', async () => {
  const { user, body } = await fixture(),
    { user: other } = await createUser(),
    hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  await expect(
    attempts.prepare(user._id, 'products', key, requestHash({ ...body, note: 'different' }), body),
  ).rejects.toMatchObject({ code: 'ATTEMPT_PAYLOAD_MISMATCH' });
  const response = await request(app)
    .get(`/api/checkout/attempts/products/${key}`)
    .set(auth(other))
    .set('Attempt-Payload-Hash', hash);
  expect(response.body.data.state).toBe('unknown');
  expect((await Attempt.findOne({ userId: user._id })).state).toBe('processing');
});
test('legacy committed checkout replays even without attempt; addressHash rejects stale selection', async () => {
  const { user, body } = await fixture();
  const first = await send(user, body);
  expect(first.status).toBe(201);
  await Attempt.deleteMany({});
  expect((await send(user, body)).body).toEqual(first.body);
  await expect(
    attempts.prepare(user._id, 'products', 'another-recovery-key-123', requestHash(body), {
      ...body,
      addressHash: '0'.repeat(64),
    }),
  ).rejects.toMatchObject({ code: 'ADDRESS_CHANGED' });
});
test('admin creation stores verified owner and rejects the entire invalid composition', async () => {
  const { brand, product } = await fixture(),
    { user: admin } = await createUser({ role: 'admin' });
  const body = {
    ownerId: String(brand.ownerId),
    name: 'Admin combo',
    descriptions: 'Combo',
    stock: 4,
    validTo: new Date(Date.now() + 86400000).toISOString(),
    discountPercent: 12.5,
    products: [{ productId: String(product._id), quantity: 1 }],
  };
  const post = (payload) =>
    request(app).post('/api/boxes/create-box').set(auth(admin)).send(payload);
  async function create(payload) {
    const response = await post(payload);
    return response.status === 201 ? { data: response.body } : { error: response.body };
  }
  const good = await create(body);
  expect(good.error).toBeUndefined();
  expect(String(good.data.data.ownerId)).toBe(String(brand.ownerId));
  expect(good.data.data.value).toBe(87500);
  for (const parts of [
    [...body.products, ...body.products],
    [{ productId: new mongoose.Types.ObjectId(), quantity: 1 }],
    [{ productId: product._id, quantity: 0 }],
  ]) {
    expect((await create({ ...body, products: parts })).error).toBeTruthy();
  }
  const foreign = await createProduct(await createBrand());
  expect(
    (await create({ ...body, products: [{ productId: foreign._id, quantity: 1 }] })).error,
  ).toBeTruthy();
  await require('../src/models/Product').updateOne(
    { _id: product._id },
    { $set: { archivedAt: new Date() } },
  );
  expect((await create(body)).error).toBeTruthy();
  expect(await Box.countDocuments()).toBe(1);
});
test('terminal rejection is durable; a new attempt needs explicit termination', async () => {
  const { user, body } = await fixture(),
    hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  await attempts.reject(
    user._id,
    'products',
    key,
    hash,
    Object.assign(new Error('bad quote'), { statusCode: 409 }),
  );
  expect((await send(user, body)).status).toBe(409);
  expect((await attempts.resolve(user._id, 'products', key, hash)).state).toBe('rejected');
  expect((await attempts.resolve(user._id, 'products', key, hash, true)).canRestart).toBe(true);
  expect(await Order.countDocuments()).toBe(0);
});
test('subscription tombstone rejects late subscribe before template or payment writes', async () => {
  const { user } = await fixture();
  const raw = {
    templateId: String(new mongoose.Types.ObjectId()),
    shippingAddress: {
      address: '123 Main street',
      district: 'District',
      city: 'City',
      country: 'VN',
      phone: '0900000000',
    },
  };
  const { value, error } =
    require('../src/middleware/validationSchemas').subscribeToTemplateSchema.validate(raw);
  expect(error).toBeUndefined();
  await attempts.resolve(user._id, 'subscription', key, requestHash(value), true);
  const response = await request(app)
    .post('/api/subcribe-plans/user-subscribe')
    .set(auth(user))
    .set('Idempotency-Key', key)
    .send(raw);
  expect(response.status).toBe(409);
  expect(await require('../src/models/UserSubscription').countDocuments()).toBe(0);
});
test('migration is dry by default, reports flag conflicts, and supports CAS rollback', async () => {
  const { brand, product } = await fixture();
  const box = await Box.create({
    ownerId: brand.ownerId,
    name: 'Legacy flags',
    descriptions: 'Legacy',
    stock: 1,
    value: 100000,
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86400000),
    products: [{ productId: product._id, quantity: 1 }],
  });
  await Box.collection.updateOne(
    { _id: box._id },
    { $unset: { subscriptionOnly: '' }, $set: { internalSubscription: true } },
  );
  const migration = require('../scripts/migrate-commerce-integrity');
  const report = await migration.plan();
  expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBeUndefined();
  expect(report.changes.some((c) => c.id === String(box._id))).toBe(true);
  await migration.apply(report);
  expect((await Box.findById(box._id)).subscriptionOnly).toBe(true);
  await migration.apply(report, true);
  expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBeNull();
  await Box.collection.updateOne({ _id: box._id }, { $set: { subscriptionOnly: false } });
  expect((await migration.plan()).conflicts.some((c) => c.id === String(box._id))).toBe(true);
});
test('migration aborts partial apply, rerun and rollback use CAS without overwriting later edits', async () => {
  const { brand, product } = await fixture();
  const box = await Box.create({
    ownerId: brand.ownerId,
    name: 'CAS fixture',
    descriptions: 'Legacy',
    stock: 1,
    value: 100000,
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86400000),
    products: [{ productId: product._id, quantity: 1 }],
  });
  await Box.collection.updateOne(
    { _id: box._id },
    { $unset: { subscriptionOnly: '' }, $set: { internalSubscription: true } },
  );
  const migration = require('../scripts/migrate-commerce-integrity'),
    report = await migration.plan();
  const interrupted = {
    ...report,
    changes: [
      ...report.changes,
      { collection: 'unsupported', id: String(box._id), before: {}, after: {} },
    ],
  };
  await expect(migration.apply(interrupted)).rejects.toThrow('Unsupported collection');
  expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBeUndefined();
  await migration.apply(report);
  expect((await migration.plan()).changes).toHaveLength(0);
  await expect(migration.apply(report)).rejects.toThrow('CAS');
  await Box.collection.updateOne({ _id: box._id }, { $set: { subscriptionOnly: false } });
  await expect(migration.apply(report, true)).rejects.toThrow('CAS');
  expect((await Box.collection.findOne({ _id: box._id })).subscriptionOnly).toBe(false);
});
test('operations HTTP exposes observed backlog/refund/webhook and attempt growth signals', async () => {
  const { user: admin } = await createUser({ role: 'admin' }),
    old = new Date(Date.now() - 2 * 86400000);
  await require('../src/models/SecurityOutbox').create({
    userId: admin._id,
    reason: 'monitor-drill',
    tokenVersion: 0,
    createdAt: old,
  });
  await require('../src/models/PaymentEvent').create({
    referenceCode: 'monitor-webhook',
    payloadHash: 'x',
    state: 'retry_required',
    createdAt: old,
  });
  await require('../src/models/ReceiptRefund').create({
    key: 'monitor-refund',
    purpose: 'receipt',
    amount: 1,
    reason: 'drill',
    createdAt: old,
  });
  const response = await request(app).get('/api/admin/operations/health-summary').set(auth(admin));
  expect(response.status).toBe(200);
  expect(response.body.data.alerts.map((a) => a.queue)).toEqual(
    expect.arrayContaining(['securityOutbox', 'webhookRetries', 'overdueRefunds']),
  );
  expect(response.body.data.attempts).toMatchObject({ total: 0, perUserLimit: 10000 });
});
test('checkout legacy migration CLI is dry by default, insert-only on rerun and blocks ownership conflicts', async () => {
  const { user, body } = await fixture();
  expect((await send(user, body)).status).toBe(201);
  const Checkout = require('../src/models/Checkout');
  await Checkout.deleteMany({});
  const { spawn } = require('node:child_process');
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/migrate-checkouts.js', ...args], {
        cwd: require('node:path').resolve(__dirname, '..'),
        env: { ...process.env, MONGODB_URI: mongoose.connection.getClient().s.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      child.stderr.resume();
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Migration CLI deadline'));
      }, 15000);
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
  const dry = await run([]);
  expect(dry.code).toBe(0);
  expect(dry.out).toContain('"candidateCount": 1');
  expect(await Checkout.countDocuments()).toBe(0);
  expect((await run(['--apply'])).code).toBe(0);
  const migrated = await Checkout.findOne();
  expect(migrated.paymentLedgerVersion).toBe(1);
  await Checkout.updateOne({ _id: migrated._id }, { $set: { totalAmount: 12345 } });
  expect((await run(['--apply'])).code).toBe(0);
  expect((await Checkout.findById(migrated._id)).totalAmount).toBe(12345);
  const indexes = await Checkout.collection.indexes();
  expect(indexes.some((i) => i.unique && i.key.userId === 1 && i.key.requestKey === 1)).toBe(true);
  await Checkout.deleteMany({});
  const order = await Order.findOne().lean(),
    { user: other } = await createUser();
  await Order.collection.insertOne({
    ...order,
    _id: new mongoose.Types.ObjectId(),
    orderId: 'LEGACY-CONFLICT-DRILL',
    userId: other._id,
  });
  const conflict = await run(['--apply']);
  expect(conflict.code).toBe(1);
  expect(conflict.out).toContain('mixed ownership/payment/coupon state');
  expect(await Checkout.countDocuments()).toBe(0);
});
test('termination waits for a request already holding the attempt write fence', async () => {
  const { user, body } = await fixture(),
    hash = requestHash(body);
  await attempts.prepare(user._id, 'products', key, hash, body);
  const realLock = attempts.lock;
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const locked = new Promise((resolve) => {
    entered = resolve;
  });
  const spy = jest.spyOn(attempts, 'lock').mockImplementation(async (...args) => {
    const result = await realLock(...args);
    entered();
    await gate;
    return result;
  });
  try {
    const creation = send(user, body).then((response) => response);
    await locked;
    const termination = attempts.resolve(user._id, 'products', key, hash, true);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    expect((await creation).status).toBe(201);
    expect((await termination).canRestart).toBe(false);
    expect(await Order.countDocuments()).toBe(1);
  } finally {
    release();
    spy.mockRestore();
  }
});
test('admin cleans successful image uploads if a later upload or creation fails', async () => {
  const cloud = require('cloudinary').v2.uploader,
    { Writable } = require('node:stream');
  let calls = 0;
  const upload = jest.spyOn(cloud, 'upload_stream').mockImplementation(
    (options, callback) =>
      new Writable({
        write(chunk, encoding, done) {
          done();
        },
        final(done) {
          calls++;
          callback(calls === 2 ? new Error('Synthetic admin upload failure') : null, {
            secure_url: 'https://test.invalid/image.webp',
            public_id: 'admin-image',
          });
          done();
        },
      }),
  );
  const destroy = jest.spyOn(cloud, 'destroy').mockResolvedValue({ result: 'ok' });
  try {
    const next = jest.fn();
    await require('../src/controllers/boxController').createBox(
      {
        validatedBody: {},
        files: [{ buffer: Buffer.from('fixture') }, { buffer: Buffer.from('fixture') }],
      },
      {},
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledWith('admin-image');
    expect(await Box.countDocuments()).toBe(0);
    calls = 0;
    next.mockClear();
    destroy.mockClear();
    await require('../src/controllers/boxController').createBox(
      {
        validatedBody: { ownerId: new mongoose.Types.ObjectId(), products: [] },
        files: [{ buffer: Buffer.from('fixture') }],
      },
      {},
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledWith('admin-image');
    expect(await Box.countDocuments()).toBe(0);
  } finally {
    upload.mockRestore();
    destroy.mockRestore();
  }
});
