const request = require('supertest');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct } = require('./helpers/factories');
const Product = require('../src/models/Product'), Box = require('../src/models/Box'), Order = require('../src/models/Order'), Subscription = require('../src/models/UserSubscription'), Refund = require('../src/models/ReceiptRefund');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
const auth = user => ({ Authorization: `Bearer ${signToken(user)}` });
async function fixture() {
  const { user: merchant } = await createUser({ role: 'merchant' }), { user: other } = await createUser({ role: 'merchant' }), { user: admin } = await createUser({ role: 'admin' }), { user: customer } = await createUser();
  const brand = await createBrand({ ownerId: merchant._id }), foreign = await createBrand({ ownerId: other._id });
  const product = await createProduct(brand, { price: 100000, stock: 100 });
  await Product.collection.updateOne({ _id: product._id }, { $set: { ownerId: merchant._id } });
  const combo = await Box.create({ ownerId: merchant._id, name: 'Acceptance combo', descriptions: 'Combo', stock: 30, value: 200000, products: [{ productId: product._id, name: product.name, quantity: 2, price: product.price }], validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 400 * 86400000) });
  return { merchant, other, admin, customer, product, combo, brand, foreign };
}
let event = 90000;
function pay(code, amount) {
  const id = ++event;
  return request(app).post('/api/checkout/sepay-webhook').set('Authorization', `Apikey ${process.env.SEPAY_API_KEY}`).send({ id, gateway: 'TestBank', transactionDate: new Date().toISOString(), accountNumber: process.env.SEPAY_BANK_ACCOUNT, code, content: code, transferType: 'in', transferAmount: amount, referenceCode: 'ACCEPT-' + id });
}
test('gift purchase -> simulated payment -> own merchant order -> cancellation restores component and gift stock', async () => {
  const f = await fixture();
  const giftRes = await request(app).post('/api/manager/gifts').set(auth(f.merchant)).send({ name: 'Acceptance gift', comboId: String(f.combo._id), stock: 10, validTo: new Date(Date.now() + 86400000).toISOString(), giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Card', fee: 5000 }] } });
  expect(giftRes.status).toBe(201); const id = giftRes.body.data._id;
  const items = [{ boxId: id, quantity: 3 }];
  expect((await request(app).put('/api/carts/sync').set(auth(f.customer)).send({ items })).status).toBe(200);
  const quote = await request(app).post('/api/checkout/quote').set(auth(f.customer)).send({ items });
  expect(quote.body.data.totalAmount).toBe(555000);
  const placed = await request(app).post('/api/checkout/check-out').set(auth(f.customer)).send({ addressId: String(f.customer.addresses[0]._id), paymentMethod: 'online', quoteFingerprint: quote.body.data.fingerprint });
  expect(placed.status).toBe(201); expect((await pay(placed.body.data.orderCode, 555000)).status).toBe(200);
  expect((await Product.findById(f.product._id)).stock).toBe(94); expect((await Box.findById(id)).stock).toBe(7);
  const order = await Order.findOne(); expect(String(order.merchantId)).toBe(String(f.merchant._id));
  expect((await request(app).get('/api/manager/orders').set(auth(f.other))).body.data).toEqual([]);
  expect((await request(app).post('/api/checkout/cancel/' + order._id).set(auth(f.customer)).send({ reason: 'Acceptance cancellation' })).status).toBe(200);
  expect((await Product.findById(f.product._id)).stock).toBe(100); expect((await Box.findById(id)).stock).toBe(10);
  expect((await Refund.findOne({ purpose: 'order' })).amount).toBe(555000);
});
test('retail subscription -> simulated full prepayment -> cancellation queues refund', async () => {
  const f = await fixture();
  const template = await request(app).post('/api/manager/retail-subscriptions').set(auth(f.merchant)).send({ name: 'Retail acceptance', products: [{ productId: String(f.product._id), quantity: 1 }], stock: 10, validTo: new Date(Date.now() + 400 * 86400000).toISOString(), planType: '3_month', discountPercent: 10 });
  expect(template.status).toBe(201);
  const started = await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(f.customer)).send({ templateId: template.body.data._id, expectedTotalAmount: 270000, shippingAddress: { address: 'Street', district: 'Test', city: 'Test', country: 'VN', phone: '0900000000' } });
  expect(started.status).toBe(201); expect((await pay(started.body.data.orderCode, 270000)).status).toBe(200);
  const subscription = await Subscription.findOne(); expect(subscription.status).toBe('active');
  const cancelled = await request(app).patch('/api/subcribe-plans/my-subscriptions/' + subscription._id + '/cancel-immediately').set(auth(f.customer)).send({});
  expect(cancelled.status).toBe(200); expect((await Subscription.findById(subscription._id)).status).toBe('cancelled');
  expect(await Refund.exists({ purpose: 'subscription' })).toBeTruthy();
});
test('admin cannot rebrand across owners or transfer populated brand; merchant cannot invoke admin assignment', async () => {
  const f = await fixture();
  expect((await request(app).put('/api/products/update-product/' + f.product._id).set(auth(f.admin)).send({ brand: String(f.foreign._id) })).status).toBe(409);
  expect((await request(app).put('/api/brands/update-brand/' + f.brand._id).set(auth(f.admin)).send({ ownerId: String(f.other._id) })).status).toBe(409);
  expect((await request(app).put('/api/brands/update-brand/' + f.brand._id).set(auth(f.merchant)).send({ ownerId: String(f.other._id) })).status).toBe(403);
  expect(String((await Product.findById(f.product._id)).ownerId)).toBe(String(f.merchant._id));
});
test('admin-only operational summary excludes customer and merchant', async () => {
  const f = await fixture();
  for (const user of [f.customer, f.merchant]) expect((await request(app).get('/api/admin/operations/health-summary').set(auth(user))).status).toBe(403);
  const res = await request(app).get('/api/admin/operations/health-summary').set(auth(f.admin));
  expect(res.status).toBe(200); expect(res.body.data.databaseConnected).toBe(true); expect(res.body.data.queues).toMatchObject({ pendingRefunds: 0, notificationOutbox: 0, securityOutbox: 0 });
});
