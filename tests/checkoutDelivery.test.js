const request = require('supertest');
const app = require('../src/app');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct, createCartWithItems, createCoupon } = require('./helpers/factories');
const Order = require('../src/models/Order');
const Checkout = require('../src/models/Checkout');
const Product = require('../src/models/Product');
const Cart = require('../src/models/Cart');
const Coupon = require('../src/models/Coupon');

beforeAll(connect);
afterEach(clearDatabase);
afterAll(closeDatabase);

describe('checkout delivery validation inside transaction (replica set)', () => {
  test.each(['phone', 'address', 'city'])('invalid stored %s leaves money/inventory/cart untouched', async field => {
    const address = { phone: '0912345678', address: '12 Nguyen Trai', district: 'Quan 1', city: 'HCM', country: 'VN' };
    delete address[field];
    const { user } = await createUser({ addresses: [address] });
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const coupon = await createCoupon();
    const res = await request(app).post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send({ addressId: String(user.addresses[0]._id), paymentMethod: 'cod', couponCode: coupon.code });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(await Order.countDocuments({ userId: user._id })).toBe(0);
    expect(await Checkout.countDocuments({ userId: user._id })).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(5);
    expect(await Cart.exists({ userId: user._id })).toBeTruthy();
    expect((await Coupon.findById(coupon._id)).usedCount).toBe(coupon.usedCount);
  });
});
