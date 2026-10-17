const request = require('supertest');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct, createCartWithItems } = require('./helpers/factories');
const Checkout = require('../src/models/Checkout');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Event = require('../src/models/PaymentEvent');
const Allocation = require('../src/models/PaymentAllocation');
const Refund = require('../src/models/ReceiptRefund');
const Audit = require('../src/models/PaymentAudit');
const { receiveWebhook, completeRefund } = require('../src/services/paymentReconciliationService');
const { expireCheckout } = require('../src/jobs/orderExpiryScheduler');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
let sequence = 1000;
function receipt(code, amount, overrides = {}) {
  const id = ++sequence;
  return { id, referenceCode: `RC-${id}`, accountNumber: process.env.SEPAY_BANK_ACCOUNT,
    code, content: code || 'Unmatched', transferType: 'in', transferAmount: amount, ...overrides };
}
async function checkout() {
  const { user } = await createUser(); const brand = await createBrand();
  const product = await createProduct(brand, { price: 100000, stock: 5 });
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
  const res = await request(app).post('/api/checkout/check-out')
    .set('Authorization', `Bearer ${signToken(user)}`)
    .send({ addressId: String(user.addresses[0]._id), paymentMethod: 'online' });
  expect(res.status).toBe(201);
  return { user, product, code: res.body.data.orderCode };
}
test('60k + 40k settles 100k once; replay cannot allocate or deduct twice', async () => {
  const { code, product } = await checkout(); const first = receipt(code, 60000);
  await receiveWebhook(first);
  expect((await Checkout.findOne({ paymentCode: code })).receivedAmount).toBe(60000);
  expect((await Product.findById(product._id)).stock).toBe(5);
  await receiveWebhook(first); await receiveWebhook(receipt(code, 40000));
  expect(await Allocation.countDocuments()).toBe(2);
  expect((await Checkout.findOne({ paymentCode: code })).state).toBe('paid');
  expect((await Product.findById(product._id)).stock).toBe(4);
});
test('QR advertises remaining 40k after receiving 60k', async () => {
  const { user, code } = await checkout(); await receiveWebhook(receipt(code, 60000));
  const res = await request(app).get(`/api/checkout/order-status/${code}`).set('Authorization', `Bearer ${signToken(user)}`);
  expect(res.body.data.remainingAmount).toBe(40000);
  expect(new URL(res.body.data.qrUrl).searchParams.get('amount')).toBe('40000');
});
test('partial receipt followed by expiry queues refund without consuming inventory', async () => {
  const { code, product } = await checkout(); await receiveWebhook(receipt(code, 60000));
  await Checkout.updateOne({ paymentCode: code }, { expiresAt: new Date(0) });
  await expireCheckout(code, new Date()); await expireCheckout(code, new Date());
  const refund = await Refund.findOne({ purpose: 'unpaid' });
  expect(refund.amount).toBe(60000); expect(await Refund.countDocuments()).toBe(1);
  expect((await Product.findById(product._id)).stock).toBe(5);
});
test('late receipt goes to audited refund queue instead of paying cancelled order', async () => {
  const { code } = await checkout(); await Checkout.updateOne({ paymentCode: code }, { expiresAt: new Date(0) });
  await expireCheckout(code, new Date()); const late = receipt(code, 100000);
  await receiveWebhook(late); await receiveWebhook(late);
  expect((await Refund.findOne({ purpose: 'receipt' })).amount).toBe(100000);
  expect(await Refund.countDocuments()).toBe(1);
  expect((await Order.findOne({ paymentCode: code })).paymentStatus).toBe('pending');
});
test('surplus and order principal refunds are separate and sum to received funds', async () => {
  const { user, code } = await checkout(); await receiveWebhook(receipt(code, 110000));
  const order = await Order.findOne({ paymentCode: code });
  const res = await request(app).post(`/api/checkout/cancel/${order._id}`)
    .set('Authorization', `Bearer ${signToken(user)}`).send({ reason: 'Cancel test' });
  expect(res.status).toBe(200);
  const refunds = await Refund.find();
  expect(refunds.map(r => r.amount).sort((a, b) => a - b)).toEqual([10000, 100000]);
});
test('extra transfer after paid queues a full separate refund', async () => {
  const { code } = await checkout(); await receiveWebhook(receipt(code, 100000));
  await receiveWebhook(receipt(code, 5000));
  expect((await Refund.findOne({ purpose: 'receipt' })).amount).toBe(5000);
  expect(await Allocation.countDocuments()).toBe(1);
});
test('same provider identity with a different amount is rejected', async () => {
  const { code } = await checkout(); const payload = receipt(code, 60000);
  await receiveWebhook(payload);
  await expect(receiveWebhook({ ...payload, transferAmount: 70000 })).rejects.toMatchObject({ statusCode: 409 });
  expect(await Allocation.countDocuments()).toBe(1);
});
test('concurrent receipts settle once and conservatively queue surplus', async () => {
  const { code, product } = await checkout();
  await Promise.all([receiveWebhook(receipt(code, 60000)), receiveWebhook(receipt(code, 50000))]);
  expect((await Checkout.findOne({ paymentCode: code })).receivedAmount).toBe(110000);
  expect((await Product.findById(product._id)).stock).toBe(4);
  expect((await Refund.findOne()).amount).toBe(10000);
});
test('refund completion is idempotent and bank reference cannot complete two refunds', async () => {
  const { user: admin } = await createUser({ role: 'admin' });
  await receiveWebhook(receipt('TMARTUNKNOWN', 10000));
  const firstEvent = await Event.findOne();
  const { refundReceipt } = require('../src/services/paymentReconciliationService');
  const queued = await refundReceipt({ eventId: firstEvent._id, key: 'refund-command-key-01',
    actorId: admin._id, reason: 'Bank evidence verified for unmatched receipt' });
  const command = { refundId: queued.refundId, amount: 10000, reference: 'BANK-OUT-1',
    evidence: 'Verified bank statement transfer BANK-OUT-1', key: 'complete-command-key-01', actorId: admin._id };
  await completeRefund(command); expect((await completeRefund(command)).replayed).toBe(true);
  const next = await Refund.create({ key: 'another', purpose: 'receipt', amount: 10000, reason: 'Test' });
  await expect(completeRefund({ ...command, refundId: String(next._id), key: 'complete-command-key-02' })).rejects.toThrow();
  expect((await Refund.findById(next._id)).status).toBe('pending');
  expect(await Audit.countDocuments({ action: 'refund_completed' })).toBe(1);
});
test('ordinary user cannot access reconciliation admin routes', async () => {
  const { user } = await createUser();
  expect((await request(app).get('/api/admin/reconciliation/refunds')
    .set('Authorization', `Bearer ${signToken(user)}`)).status).toBe(403);
});
