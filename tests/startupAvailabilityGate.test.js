const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const { setServerReady, isServerReady } = require('../src/controllers/healthController');
const Checkout = require('../src/models/Checkout');
const CheckoutAttempt = require('../src/models/CheckoutAttempt');
const Order = require('../src/models/Order');
const AuthSession = require('../src/models/AuthSession');

describe('Startup Availability Gate & 503 Invariant (Phase 3)', () => {
  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    setServerReady(true);
    await db.closeDatabase();
  });

  beforeEach(async () => {
    await db.clearDatabase();
  });

  test('during startup (gate closed), liveness returns 200 while health, checkout, webhook, and login return 503 with Retry-After and 0 DB writes', async () => {
    setServerReady(false);
    expect(isServerReady()).toBe(false);

    // 1. Liveness returns 200 so orchestrator/Render knows container is alive
    const liveRes = await request(app).get('/api/home/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body).toEqual({ success: true, status: 'alive' });

    // 2. Readiness returns 503 not_ready
    const healthRes = await request(app).get('/api/home/health');
    expect(healthRes.status).toBe(503);
    expect(healthRes.body).toEqual({ success: false, status: 'not_ready' });

    // 3. Login attempt receives 503 + Retry-After
    const loginRes = await request(app)
      .post('/api/home/login')
      .send({ email: 'any@example.com', password: 'Password123!' });
    expect(loginRes.status).toBe(503);
    expect(loginRes.headers['retry-after']).toBe('5');
    expect(loginRes.body).toMatchObject({
      success: false,
      code: 'SERVER_STARTING',
    });

    // 4. Checkout attempt receives 503 + Retry-After
    const checkoutRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Idempotency-Key', 'checkout-gate-test-12345678')
      .send({
        addressId: '507f1f77bcf86cd799439011',
        paymentMethod: 'cod',
      });
    expect(checkoutRes.status).toBe(503);
    expect(checkoutRes.headers['retry-after']).toBe('5');
    expect(checkoutRes.body).toMatchObject({
      success: false,
      code: 'SERVER_STARTING',
    });

    // 5. SePay webhook receives 503 + Retry-After so SePay retries later
    const webhookRes = await request(app).post('/api/checkout/sepay-webhook').send({
      id: 123456,
      gateway: 'MBBank',
      transactionDate: '2026-11-11 10:00:00',
      accountNumber: '0000000000',
      transferType: 'in',
      transferAmount: 100000,
      content: 'TMART_EXAMPLE',
    });
    expect(webhookRes.status).toBe(503);
    expect(webhookRes.headers['retry-after']).toBe('5');
    expect(webhookRes.body).toMatchObject({
      success: false,
      code: 'SERVER_STARTING',
    });

    // Verify 0 database writes occurred during the unready state
    expect(await Checkout.countDocuments({})).toBe(0);
    expect(await CheckoutAttempt.countDocuments({})).toBe(0);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await AuthSession.countDocuments({})).toBe(0);
  });

  test('once startup completes (gate opened), readiness returns 200 and traffic is accepted', async () => {
    setServerReady(true);
    expect(isServerReady()).toBe(true);

    const healthRes = await request(app).get('/api/home/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body).toEqual({ success: true, status: 'ready' });

    // Requests now proceed past the gate to normal route validation/handlers
    const loginRes = await request(app)
      .post('/api/home/login')
      .send({ email: 'nonexistent@example.com', password: 'Password123!' });
    // Expect 400 or 401 from auth logic, NOT 503 SERVER_STARTING
    expect(loginRes.status).not.toBe(503);
    expect(loginRes.body.code).not.toBe('SERVER_STARTING');
  });
});
