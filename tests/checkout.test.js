const request = require('supertest');
const app = require('../src/app');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
  createCoupon,
} = require('./helpers/factories');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Cart = require('../src/models/Cart');
const Coupon = require('../src/models/Coupon');
const Checkout = require('../src/models/Checkout');

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/checkout/check-out', () => {
  test('rejects when the cart is empty (regression test for the isSubscribeCart field-name bug)', async () => {
    const { user } = await createUser();
    const token = signToken(user);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('places a COD order, deducts stock immediately, and empties the cart', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(await Order.countDocuments({ paymentCode: res.body.data.orderCode })).toBe(1);
    expect(res.body.data.totalAmount).toBe(100000);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(3);

    const order = await Order.findOne({ userId: user._id });
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('pending');
    expect(order.stockDeducted).toBe(true);

    const cart = await Cart.findOne({
      userId: user._id,
      isSubscribeCart: false,
    });
    expect(cart).toBeNull();
  });

  test('does NOT deduct stock and does NOT create an order for an online payment until confirmed', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'online',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.orderCode).toMatch(/^TMART/);
    expect(res.body.data.paymentCode).toMatch(/^TMART/);
    expect(res.body.data.status).toBe('pending_payment');
    expect(res.body.data.qrUrl).toBeDefined();

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(5);

    const order = await Order.findOne({ userId: user._id });
    expect(order).toBeNull();

    const checkout = await Checkout.findOne({ userId: user._id });
    expect(checkout).not.toBeNull();
    expect(checkout.state).toBe('pending');
    expect(checkout.paymentMethod).toBe('online');

    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart).not.toBeNull();
  });

  test('rejects checkout when the requested quantity exceeds available stock, without mutating stock', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 1 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 5 }]);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });

    expect(res.status).toBe(400);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(1);
    expect(await Order.countDocuments({})).toBe(0);
  });

  test('rejects checkout with an invalid addressId', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand);
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: '507f1f77bcf86cd799439011', paymentMethod: 'cod' });

    expect(res.status).toBe(400);
  });

  test('splits an order per merchant when the cart mixes products from different brands', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brandA = await createBrand();
    const brandB = await createBrand();
    const productA = await createProduct(brandA, { price: 100000, stock: 5 });
    const productB = await createProduct(brandB, { price: 200000, stock: 5 });
    await createCartWithItems(user._id, [
      { productId: productA._id, quantity: 1 },
      { productId: productB._id, quantity: 1 },
    ]);

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });

    expect(res.status).toBe(201);
    expect(await Order.countDocuments({ paymentCode: res.body.data.orderCode })).toBe(2);
    expect(res.body.data.totalAmount).toBe(300000);

    const orders = await Order.find({ userId: user._id });
    const merchantIds = new Set(orders.map((o) => o.merchantId.toString()));
    expect(merchantIds.size).toBe(2);
  });

  test('applies a valid percentage coupon and increments its usage count', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const coupon = await createCoupon({
      discountType: 'percentage',
      discount: 10,
    });

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
        couponCode: coupon.code,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(90000);

    const updatedCoupon = await Coupon.findById(coupon._id);
    expect(updatedCoupon.usedCount).toBe(1);
  });

  test('rejects an expired coupon without deducting stock or coupon usage', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const coupon = await createCoupon({
      startDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
        couponCode: coupon.code,
      });

    expect(res.status).toBe(400);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(5);
    const updatedCoupon = await Coupon.findById(coupon._id);
    expect(updatedCoupon.usedCount).toBe(0);
  });

  test('a coupon at its usage limit is rejected on the next attempt', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    const coupon = await createCoupon({ usageLimit: 1 });

    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const first = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
        couponCode: coupon.code,
      });
    expect(first.status).toBe(201);

    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const second = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
        couponCode: coupon.code,
      });
    expect(second.status).toBe(409);
  });
});

describe('POST /api/checkout/cancel/:_id', () => {
  test('cancelling a pending COD order restores stock', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const checkoutRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });

    const order = await Order.findOne({
      _id: checkoutRes.body.data.orderId,
    });
    expect((await Product.findById(product._id)).stock).toBe(3);

    const cancelRes = await request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Đổi ý' });

    expect(cancelRes.status).toBe(200);
    const restoredProduct = await Product.findById(product._id);
    expect(restoredProduct.stock).toBe(5);
  });

  test("a user cannot cancel another user's order", async () => {
    const { user: owner } = await createUser();
    const { user: intruder } = await createUser();
    const intruderToken = signToken(intruder);
    const brand = await createBrand();
    const product = await createProduct(brand, { stock: 5 });
    await createCartWithItems(owner._id, [{ productId: product._id, quantity: 1 }]);

    const checkoutRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${signToken(owner)}`)
      .send({
        addressId: owner.addresses[0]._id.toString(),
        paymentMethod: 'cod',
      });
    const order = await Order.findOne({
      _id: checkoutRes.body.data.orderId,
    });

    const res = await request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ reason: 'n/a' });

    expect(res.status).toBe(403);
  });
});

describe('Checkout Session endpoints (POST, GET, cancel)', () => {
  test('getSession and cancelSession enforce ownership even when looked up by paymentCode', async () => {
    const { user: owner } = await createUser();
    const { user: intruder } = await createUser();
    const ownerToken = signToken(owner);
    const intruderToken = signToken(intruder);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 10 });
    await createCartWithItems(owner._id, [{ productId: product._id, quantity: 1 }]);

    const createRes = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addressId: owner.addresses[0]._id.toString() });

    expect(createRes.status).toBe(201);
    const { paymentCode, sessionId } = createRes.body.data;

    // Intruder cannot view session via sessionId or paymentCode
    const getByIdIntruder = await request(app)
      .get(`/api/checkout/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(getByIdIntruder.status).toBe(403);

    const getByCodeIntruder = await request(app)
      .get(`/api/checkout/sessions/${paymentCode}`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(getByCodeIntruder.status).toBe(403);

    // Intruder cannot cancel session
    const cancelIntruder = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ reason: 'malicious' });
    expect(cancelIntruder.status).toBe(403);

    // Owner can access via both id and paymentCode
    const getByIdOwner = await request(app)
      .get(`/api/checkout/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(getByIdOwner.status).toBe(200);
    expect(getByIdOwner.body.data.paymentCode).toBe(paymentCode);
    expect(getByIdOwner.body.data.state).toBe('pending');

    const getByCodeOwner = await request(app)
      .get(`/api/checkout/sessions/${paymentCode}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(getByCodeOwner.status).toBe(200);
    expect(getByCodeOwner.body.data.state).toBe('pending');
  });

  test('cancelSession transitions atomically from pending and rejects non-pending or expired sessions', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 60000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const createRes = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    const { paymentCode } = createRes.body.data;

    // First cancel succeeds
    const cancelRes = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Changed mind' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.state).toBe('cancelled');

    const dbSession = await Checkout.findOne({ paymentCode });
    expect(dbSession.state).toBe('cancelled');

    // Second cancel is rejected with 409
    const cancelAgain = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Duplicate cancel' });
    expect(cancelAgain.status).toBe(409);
  });

  test('fingerprint duplicate check reuses session on identical cart & coupon, but cancels old session on change', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product1 = await createProduct(brand, { price: 30000, stock: 10 });
    const product2 = await createProduct(brand, { price: 40000, stock: 10 });
    await createCoupon({ code: 'DISCOUNT10', discount: 10 });

    await createCartWithItems(user._id, [{ productId: product1._id, quantity: 1 }]);

    // Create session with coupon
    const res1 = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: 'DISCOUNT10' });

    expect(res1.status).toBe(201);
    const code1 = res1.body.data.paymentCode;

    // 1. Same request with same cart & coupon -> returns identical session
    const res2 = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: 'DISCOUNT10' });

    expect(res2.status).toBe(201);
    expect(res2.body.data.paymentCode).toBe(code1);

    // Coupon usedCount should be 1
    const couponAfterRes2 = await Coupon.findOne({ code: 'DISCOUNT10' });
    expect(couponAfterRes2.usedCount).toBe(1);

    // 2. Change cart -> old session is cancelled (releasing coupon), new session created
    await Cart.updateOne(
      { userId: user._id, isSubscribeCart: false },
      {
        $set: {
          items: [
            { productId: product1._id, quantity: 1 },
            { productId: product2._id, quantity: 1 },
          ],
        },
      },
    );

    const res3 = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: 'DISCOUNT10' });

    expect(res3.status).toBe(201);
    const code3 = res3.body.data.paymentCode;
    expect(code3).not.toBe(code1);

    // Old session should now be cancelled
    const oldSession = await Checkout.findOne({ paymentCode: code1 });
    expect(oldSession.state).toBe('cancelled');

    // New session is pending
    const newSession = await Checkout.findOne({ paymentCode: code3 });
    expect(newSession.state).toBe('pending');
  });

  test('lazy-expire in getSession and checkOut marks expired and releases coupon', async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCoupon({ code: 'EXPIRECOUPON', discount: 10 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    // Create session with coupon
    const res = await request(app)
      .post('/api/checkout/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: 'EXPIRECOUPON' });

    expect(res.status).toBe(201);
    const { paymentCode, sessionId } = res.body.data;

    expect((await Coupon.findOne({ code: 'EXPIRECOUPON' })).usedCount).toBe(1);

    // Simulate expiration by backdating expiresAt
    await Checkout.updateOne(
      { paymentCode },
      { $set: { expiresAt: new Date(Date.now() - 60000) } },
    );

    // getSession triggers lazy-expire
    const pollRes = await request(app)
      .get(`/api/checkout/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(pollRes.status).toBe(200);
    expect(pollRes.body.data.state).toBe('expired');

    // Check that DB state is 'expired' and coupon usedCount is restored to 0
    const expiredSession = await Checkout.findOne({ paymentCode });
    expect(expiredSession.state).toBe('expired');

    const restoredCoupon = await Coupon.findOne({ code: 'EXPIRECOUPON' });
    expect(restoredCoupon.usedCount).toBe(0);

    // cancelSession on expired session returns 409
    const cancelRes = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Too late' });
    expect(cancelRes.status).toBe(409);
  });
});
