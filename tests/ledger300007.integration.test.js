const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const { createUser, createBrand, createProduct, signToken } = require('./helpers/factories');
const Checkout = require('../src/models/Checkout');
const Event = require('../src/models/PaymentEvent');
const Allocation = require('../src/models/PaymentAllocation');
const Refund = require('../src/models/ReceiptRefund');
const Subscription = require('../src/models/UserSubscription');
const Product = require('../src/models/Product');
const Box = require('../src/models/Box');
const Template = require('../src/models/SubscriptionTemplate');
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
beforeAll(db.connect);
afterEach(db.clearDatabase);
afterAll(db.closeDatabase);

test('two partial receipts total 300007: allocation includes surplus once and full cancellation refunds exactly received money', async () => {
  const { user } = await createUser();
  const brand = await createBrand();
  const product = await createProduct(brand, { price: 100000 });
  const box = await Box.create({
    ownerId: brand.ownerId,
    name: 'Ledger fixture box',
    descriptions: 'Synthetic ledger fixture',
    stock: 10,
    validFrom: new Date(Date.now() - 10000),
    validTo: new Date(Date.now() + 86400000),
    value: 100000,
    products: [{ productId: product._id, quantity: 1, price: 100000, name: product.name }],
  });
  const template = await Template.create({
    ownerId: brand.ownerId,
    name: 'Ledger fixture plan',
    boxId: box._id,
    planType: '3_month',
    basePrice: 300000,
    discountPrice: 300000,
    discountPercent: 0,
  });
  const auth = { Authorization: 'Bearer ' + signToken(user) };
  const bought = await request(app)
    .post('/api/subcribe-plans/user-subscribe')
    .set(auth)
    .set('Idempotency-Key', 'b-ledger-two-partials-300007')
    .send({
      templateId: String(template._id),
      expectedTotalAmount: 300000,
      shippingAddress: user.addresses[0].toObject(),
    });
  expect(bought.status).toBe(201);
  const paymentCode = bought.body.data.orderCode;
  const receipts = [100001, 200006].map((transferAmount, index) => ({
    id: 930001 + index,
    gateway: 'FixtureBank',
    transactionDate: '2026-10-22 00:00:00',
    accountNumber: process.env.SEPAY_BANK_ACCOUNT,
    code: paymentCode,
    content: paymentCode,
    transferType: 'in',
    transferAmount,
    referenceCode: 'B-300007-' + index,
  }));
  const deliver = (body) =>
    request(app)
      .post('/api/checkout/sepay-webhook')
      .set('Authorization', 'Apikey ' + process.env.SEPAY_API_KEY)
      .send(body);
  expect((await deliver(receipts[0])).status).toBe(200);
  let checkout = await Checkout.findOne({ paymentCode });
  expect(checkout.receivedAmount).toBe(100001);
  expect(checkout.state).toBe('pending');
  expect(await Refund.countDocuments({ checkoutId: checkout._id })).toBe(0);
  expect((await Subscription.findById(bought.body.data._id)).status).toBe('pending_payment');
  expect((await deliver(receipts[1])).status).toBe(200);
  for (const body of receipts) expect((await deliver(body)).status).toBe(200);
  checkout = await Checkout.findOne({ paymentCode });
  expect(checkout.totalAmount).toBe(300000);
  expect(checkout.receivedAmount).toBe(300007);
  expect(checkout.overpaidAmount).toBe(7);
  expect(checkout.state).toBe('paid');
  let refunds = await Refund.find({ checkoutId: checkout._id });
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({ purpose: 'surplus', amount: 7, status: 'pending' });
  expect((await Subscription.findById(bought.body.data._id)).status).toBe('active');
  const cancel = () =>
    request(app)
      .patch(`/api/subcribe-plans/my-subscriptions/${bought.body.data._id}/cancel-immediately`)
      .set(auth)
      .send({});
  for (let retry = 0; retry < 2; retry++) expect((await cancel()).status).toBe(200);
  // Re-delivery after cancellation remains deduplicated; it is not a new late receipt.
  for (const body of receipts) expect((await deliver(body)).status).toBe(200);
  checkout = await Checkout.findById(checkout._id);
  const events = await Event.find({ paymentCode });
  const allocations = await Allocation.find({ checkoutId: checkout._id });
  refunds = await Refund.find({ checkoutId: checkout._id });
  expect(events).toHaveLength(2);
  expect(allocations).toHaveLength(2);
  expect(new Set(allocations.map((allocation) => String(allocation.eventId))).size).toBe(2);
  expect(allocations.map((allocation) => allocation.amount).sort((a, b) => a - b)).toEqual([
    100001, 200006,
  ]);
  expect(events.every((event) => event.disposition === 'applied')).toBe(true);
  expect(sum(events, 'transferAmount')).toBe(300007);
  expect(sum(allocations, 'amount')).toBe(300007);
  expect(checkout.receivedAmount).toBe(sum(allocations, 'amount'));
  expect(refunds).toHaveLength(2);
  expect(
    sum(
      refunds.filter((refund) => refund.purpose === 'subscription'),
      'amount',
    ),
  ).toBe(300000);
  expect(
    sum(
      refunds.filter((refund) => refund.purpose === 'surplus'),
      'amount',
    ),
  ).toBe(7);
  expect(sum(refunds, 'amount')).toBe(300007);
  expect(refunds.every((refund) => refund.status === 'pending')).toBe(true);
  const completed = sum(
    refunds.filter((refund) => refund.status === 'completed'),
    'amount',
  );
  expect(completed).toBe(0);
  const pending = sum(
    refunds.filter((refund) => refund.status === 'pending'),
    'amount',
  );
  expect(sum(allocations, 'amount')).toBe(0 + pending + completed);
  expect((await Subscription.findById(bought.body.data._id)).refundAmount).toBe(300000);
  expect((await Product.findById(product._id)).stock).toBe(10);
  expect((await Box.findById(box._id)).stock).toBe(10);
});
