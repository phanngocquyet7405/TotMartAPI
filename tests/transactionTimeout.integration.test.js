const request = require('supertest');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

jest.mock('../src/config/environment', () =>
  require('../src/config/resolveEnvironment').resolveEnvironment({
    NODE_ENV: 'test',
    JWT_SECRET: 'fixture-auth-key-transaction-timeout-12345',
    JWT_REFRESH_SECRET: 'fixture-refresh-key-transaction-timeout-67890',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/disposable?replicaSet=rs0',
    FRONTEND_URL: 'https://fixture.invalid',
    SEPAY_API_KEY: 'fixture-api-key',
    SEPAY_BANK_ACCOUNT: '0000000000',
    SEPAY_BANK_NAME: 'Fixture',
    MONGO_SOCKET_TIMEOUT_MS: '30000',
    MONGO_WAIT_QUEUE_TIMEOUT_MS: '5000',
    MONGO_MAX_COMMIT_TIME_MS: '2000',
    MONGO_TRANSACTION_TIMEOUT_MS: '2000',
  }),
);

const app = require('../src/app');
const db = require('./helpers/db');
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
} = require('./helpers/factories');
const Checkout = require('../src/models/Checkout');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const CheckoutAttempt = require('../src/models/CheckoutAttempt');
const { requestHash } = require('../src/services/checkoutLifecycle');

let testUser;
let testToken;
let testProduct;
let addressId;

beforeAll(async () => {
  await db.connect({ mongoArgs: ['--setParameter', 'enableTestCommands=1'] });
});

beforeEach(async () => {
  await db.clearDatabase();
  const { user } = await createUser();
  testUser = user;
  testToken = signToken(user);
  addressId = String(user.addresses[0]._id);

  const brand = await createBrand();
  testProduct = await createProduct(brand, { price: 100000, stock: 10 });
});

afterAll(async () => {
  try {
    await mongoose.connection.db
      ?.admin()
      .command({ ping: 1 })
      .catch(() => {});
  } finally {
    await mongoose.disconnect();
    await db.closeDatabase();
  }
}, 30000);

describe('Mongo transaction timeout and resilience (B-A1-AV01)', () => {
  test('(a) Mongo silent/stalled insert aborts with finite 503 and does not hang indefinitely', async () => {
    const key = `timeout-finite-${randomUUID()}`;
    await createCartWithItems(testUser._id, [{ productId: testProduct._id, quantity: 1 }]);

    const body = {
      addressId,
      paymentMethod: 'cod',
      note: 'Stall test',
    };

    // Prepare attempt
    const prepareRes = await request(app)
      .post('/api/checkout/attempts/products/prepare')
      .set('Authorization', `Bearer ${testToken}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(prepareRes.status).toBe(200);

    const admin = mongoose.connection.db.admin();

    // Configure failpoint to block insert commands for 6000ms (exceeding 2000ms transaction timeout)
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['insert'],
        blockConnection: true,
        blockTimeMS: 6000,
      },
    });

    const startTime = Date.now();
    try {
      const res = await request(app)
        .post('/api/checkout/check-out')
        .set('Authorization', `Bearer ${testToken}`)
        .set('Idempotency-Key', key)
        .send(body);

      const elapsed = Date.now() - startTime;
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      // Confirms bounded finish well before 6000ms block
      expect(elapsed).toBeLessThan(4500);
      expect(elapsed).toBeGreaterThanOrEqual(1800);
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  });

  test('(b) After 503 timeout, replay with the same key/body completes successfully and stock is NOT deducted twice', async () => {
    const key = `timeout-replay-${randomUUID()}`;
    await createCartWithItems(testUser._id, [{ productId: testProduct._id, quantity: 1 }]);

    const initialProduct = await Product.findById(testProduct._id);
    const initialStock = initialProduct.stock;

    const body = {
      addressId,
      paymentMethod: 'cod',
      note: 'Replay test after timeout',
    };

    // 1. Prepare attempt
    const prep = await request(app)
      .post('/api/checkout/attempts/products/prepare')
      .set('Authorization', `Bearer ${testToken}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(prep.status).toBe(200);

    // 2. Trigger timeout via failpoint
    const admin = mongoose.connection.db.admin();
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['insert'],
        blockConnection: true,
        blockTimeMS: 5000,
      },
    });

    try {
      const failRes = await request(app)
        .post('/api/checkout/check-out')
        .set('Authorization', `Bearer ${testToken}`)
        .set('Idempotency-Key', key)
        .send(body);
      expect(failRes.status).toBe(503);
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }

    // Verify stock has not changed after failed transaction
    const midProduct = await Product.findById(testProduct._id);
    expect(midProduct.stock).toBe(initialStock);

    // 3. Replay with the exact same key & body
    const replayRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${testToken}`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(replayRes.status).toBe(201);
    expect(replayRes.body.success).toBe(true);
    expect(replayRes.body.data.orderId).toBeDefined();

    // Verify stock is deducted exactly once
    const finalProduct = await Product.findById(testProduct._id);
    expect(finalProduct.stock).toBe(initialStock - 1);

    // Verify exactly 1 Checkout and 1 Order exist for this key
    const checkouts = await Checkout.find({ userId: testUser._id, requestKey: key });
    expect(checkouts).toHaveLength(1);

    const orders = await Order.find({ paymentCode: checkouts[0].paymentCode });
    expect(orders).toHaveLength(1);

    // 4. Repeated replay returns the exact same result without double deduction
    const secondReplayRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${testToken}`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(secondReplayRes.status).toBe(201);
    expect(secondReplayRes.body.data).toEqual(replayRes.body.data);

    const productAfterSecondReplay = await Product.findById(testProduct._id);
    expect(productAfterSecondReplay.stock).toBe(initialStock - 1);
  });

  test('(c) Timeout preserves the CheckoutAttempt record and tombstone/fencing invariants', async () => {
    const key = `timeout-attempt-${randomUUID()}`;
    await createCartWithItems(testUser._id, [{ productId: testProduct._id, quantity: 1 }]);

    const body = {
      addressId,
      paymentMethod: 'cod',
      note: 'Attempt preservation test',
    };

    // Prepare attempt
    await request(app)
      .post('/api/checkout/attempts/products/prepare')
      .set('Authorization', `Bearer ${testToken}`)
      .set('Idempotency-Key', key)
      .send(body);

    const hash = requestHash(body);
    const attemptBefore = await CheckoutAttempt.findOne({
      userId: testUser._id,
      kind: 'products',
      key,
    });
    expect(attemptBefore).not.toBeNull();
    expect(attemptBefore.hash).toBe(hash);

    // Trigger failpoint on commitTransaction
    const admin = mongoose.connection.db.admin();
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['commitTransaction'],
        blockConnection: true,
        blockTimeMS: 5000,
      },
    });

    try {
      const res = await request(app)
        .post('/api/checkout/check-out')
        .set('Authorization', `Bearer ${testToken}`)
        .set('Idempotency-Key', key)
        .send(body);
      expect(res.status).toBe(503);
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }

    // Verify attempt record is NOT lost or deleted
    const attemptAfter = await CheckoutAttempt.findOne({
      userId: testUser._id,
      kind: 'products',
      key,
    });
    expect(attemptAfter).not.toBeNull();
    expect(attemptAfter.key).toBe(key);
    expect(attemptAfter.hash).toBe(hash);
  });
});
