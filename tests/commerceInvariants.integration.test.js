const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const db = require('./helpers/db');
const {
  createUser,
  createBrand,
  createProduct,
  createCoupon,
  createCartWithItems,
  signToken,
} = require('./helpers/factories');
const Checkout = require('../src/models/Checkout');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Coupon = require('../src/models/Coupon');
const Event = require('../src/models/PaymentEvent');
const Allocation = require('../src/models/PaymentAllocation');
const Refund = require('../src/models/ReceiptRefund');
const Audit = require('../src/models/PaymentAudit');
const Box = require('../src/models/Box');
const Version = require('../src/models/BoxVersion');
const Template = require('../src/models/SubscriptionTemplate');
const Subscription = require('../src/models/UserSubscription');
const { expireCheckout } = require('../src/jobs/orderExpiryScheduler');
const auth = (user) => ({ Authorization: 'Bearer ' + signToken(user) });
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
beforeAll(db.connect);
afterEach(db.clearDatabase);
afterAll(db.closeDatabase);
async function snapshot() {
  return Promise.all(
    [
      Checkout,
      Order,
      Product,
      Coupon,
      Event,
      Allocation,
      Refund,
      Audit,
      Box,
      Version,
      Template,
      Subscription,
      require('../src/models/Cart'),
    ].map((Model) => Model.find().sort({ _id: 1 }).lean()),
  );
}
let receiptSequence = 90000;
async function webhook(code, amount, previous) {
  const body = previous || {
    id: ++receiptSequence,
    gateway: 'FixtureBank',
    transactionDate: '2026-10-20 00:00:00',
    accountNumber: process.env.SEPAY_BANK_ACCOUNT,
    code,
    content: code,
    transferType: 'in',
    transferAmount: amount,
    referenceCode: `B06-${receiptSequence}`,
  };
  const response = await request(app)
    .post('/api/checkout/sepay-webhook')
    .set('Authorization', `Apikey ${process.env.SEPAY_API_KEY}`)
    .send(body);
  return { response, body };
}
async function assertReceiptPartition() {
  const events = await Event.find({ paymentLedgerVersion: 2 });
  const allocations = await Allocation.find();
  const direct = events.filter((e) => ['refund_pending', 'refunded'].includes(e.disposition));
  const unallocated = events.filter((e) => e.disposition === 'unallocated');
  expect(sum(events, 'transferAmount')).toBe(
    sum(allocations, 'amount') + sum(unallocated, 'transferAmount') + sum(direct, 'transferAmount'),
  );
  for (const checkout of await Checkout.find())
    expect(checkout.receivedAmount).toBe(
      sum(
        allocations.filter((a) => a.checkoutId.equals(checkout._id)),
        'amount',
      ),
    );
  for (const event of direct)
    expect(sum(await Refund.find({ eventId: event._id }), 'amount')).toBe(event.transferAmount);
}
async function combo(product, ownerId) {
  return Box.create({
    ownerId,
    name: 'Invariant combo',
    descriptions: 'Fixture composition',
    stock: 10,
    validFrom: new Date(Date.now() - 10000),
    validTo: new Date(Date.now() + 86400000),
    value: product.price,
    products: [{ productId: product._id, quantity: 1, price: product.price, name: product.name }],
  });
}
test('B06 multi-merchant receipt/refund equations conserve VND, coupon and stock through replay/cancel/expiry/late receipt', async () => {
  const { user } = await createUser(),
    { user: admin } = await createUser({ role: 'admin' });
  const brands = [await createBrand(), await createBrand()];
  const products = [
    await createProduct(brands[0], { price: 100001 }),
    await createProduct(brands[1], { price: 100002 }),
  ];
  const coupon = await createCoupon({ discountType: 'fixed', discount: 1 });
  await createCartWithItems(
    user._id,
    products.map((p) => ({ productId: p._id, quantity: 1 })),
  );
  const payload = {
    addressId: String(user.addresses[0]._id),
    paymentMethod: 'online',
    couponCode: coupon.code,
  };
  const create = () =>
    request(app)
      .post('/api/checkout/check-out')
      .set(auth(user))
      .set('Idempotency-Key', 'b06-multi-merchant-finance')
      .send(payload);
  const first = await create();
  expect(first.status).toBe(201);
  expect((await create()).body.data).toEqual(first.body.data);
  const code = first.body.data.orderCode;
  let checkout = await Checkout.findOne({ paymentCode: code });
  let orders = await Order.find({ paymentCode: code });
  expect(orders).toHaveLength(2);
  expect(checkout.totalAmount).toBe(200002);
  expect(sum(orders, 'totalAmount')).toBe(checkout.totalAmount);
  expect(sum(orders, 'discountAmount')).toBe(1);
  expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
  const partial = await webhook(code, 60000);
  expect(partial.response.status).toBe(200);
  expect((await webhook(code, 60000, partial.body)).response.status).toBe(200);
  expect(await Allocation.countDocuments()).toBe(1);
  expect((await Checkout.findById(checkout._id)).state).toBe('pending');
  expect(
    (await Product.find({ _id: { $in: products.map((p) => p._id) } })).map((p) => p.stock),
  ).toEqual([10, 10]);
  await assertReceiptPartition();
  const payment = await webhook(code, 140009);
  expect(payment.response.status).toBe(200);
  checkout = await Checkout.findById(checkout._id);
  expect(checkout.receivedAmount).toBe(200009);
  expect(checkout.overpaidAmount).toBe(7);
  expect(checkout.state).toBe('paid');
  expect(sum(await Refund.find({ purpose: 'surplus' }), 'amount')).toBe(7);
  expect(
    (await Product.find({ _id: { $in: products.map((p) => p._id) } })).map((p) => p.stock),
  ).toEqual([9, 9]);
  const beforeMismatch = await snapshot();
  expect(
    (await webhook(code, 0, { ...payment.body, transferAmount: 140010 })).response.status,
  ).toBe(409);
  const afterMismatch = await snapshot();
  // Mongoose timestamps update this receipt's probe metadata before payloadHash comparison.
  // Check every other field/collection exactly, and explicitly bound the timestamp-only exception.
  for (const [index, event] of afterMismatch[4].entries()) {
    if (event.providerEventId === String(payment.body.id)) {
      expect(event.updatedAt.getTime()).toBeGreaterThanOrEqual(
        beforeMismatch[4][index].updatedAt.getTime(),
      );
      event.updatedAt = beforeMismatch[4][index].updatedAt;
    }
  }
  expect(afterMismatch).toEqual(beforeMismatch);
  orders = await Order.find({ paymentCode: code });
  const cancel = (order) =>
    request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set(auth(user))
      .send({ reason: 'Fixture cancellation' });
  await Promise.all(orders.flatMap((order) => [cancel(order), cancel(order)]));
  await expireCheckout(code, new Date(Date.now() + 86400000 * 2));
  expect((await Order.find({ paymentCode: code })).every((o) => o.status === 'cancelled')).toBe(
    true,
  );
  const refunds = await Refund.find({ checkoutId: checkout._id });
  expect(
    sum(
      refunds.filter((r) => r.purpose === 'order'),
      'amount',
    ),
  ).toBe(200002);
  expect(sum(refunds, 'amount')).toBe(200009); // Surplus counted once, not added to principal again.
  expect(refunds.every((r) => r.status === 'pending')).toBe(true);
  expect(
    (await Product.find({ _id: { $in: products.map((p) => p._id) } })).map((p) => p.stock),
  ).toEqual([10, 10]);
  expect((await Coupon.findById(coupon._id)).usedCount).toBe(0);
  const late = await webhook(code, 5000);
  expect(late.response.status).toBe(200);
  expect((await webhook(code, 5000, late.body)).response.status).toBe(200);
  await assertReceiptPartition();
  const allRefunds = await Refund.find();
  expect(sum(allRefunds, 'amount')).toBe(205009);
  expect(
    sum(
      allRefunds.filter((r) => r.status === 'completed'),
      'amount',
    ),
  ).toBe(0); // Pending is not cash transferred.
  const principal = allRefunds.find((r) => r.purpose === 'order');
  const complete = (refund, key, reference) =>
    request(app)
      .post(`/api/admin/reconciliation/refunds/${refund._id}/complete`)
      .set(auth(admin))
      .set('Idempotency-Key', key)
      .send({ amount: refund.amount, reference, evidence: 'Fixture independent bank evidence' });
  expect((await complete(principal, 'b06-complete-principal', 'B06-BANK-OUT')).status).toBe(200);
  expect(
    (await complete(principal, 'b06-complete-principal', 'B06-BANK-OUT')).body.data.replayed,
  ).toBe(true);
  const beforeDuplicateBank = await snapshot();
  expect(
    (
      await complete(
        allRefunds.find((r) => r.purpose === 'surplus'),
        'b06-complete-surplus',
        'B06-BANK-OUT',
      )
    ).status,
  ).toBe(409);
  expect(await snapshot()).toEqual(beforeDuplicateBank);
  const final = await Refund.find();
  expect(
    sum(
      final.filter((r) => r.status === 'completed'),
      'amount',
    ),
  ).toBe(principal.amount);
  expect(
    sum(
      final.filter((r) => r.status === 'pending'),
      'amount',
    ) + principal.amount,
  ).toBe(205009);
  expect(await Audit.countDocuments({ action: 'refund_completed' })).toBe(1);
});

test('B06 partial receipt expiry/cancel race preserves all received money as one pending liability', async () => {
  const { user } = await createUser(),
    product = await createProduct(await createBrand());
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
  const first = await request(app)
    .post('/api/checkout/check-out')
    .set(auth(user))
    .set('Idempotency-Key', 'b06-partial-expiry-key')
    .send({ addressId: String(user.addresses[0]._id), paymentMethod: 'online' });
  expect(first.status).toBe(201);
  const code = first.body.data.orderCode;
  expect((await webhook(code, 60000)).response.status).toBe(200);
  await Checkout.updateOne({ paymentCode: code }, { expiresAt: new Date(0) });
  const order = await Order.findOne({ paymentCode: code });
  await Promise.all([
    expireCheckout(code, new Date()),
    request(app).post(`/api/checkout/cancel/${order._id}`).set(auth(user)).send({}),
  ]);
  await expireCheckout(code, new Date());
  const refunds = await Refund.find();
  expect(refunds).toHaveLength(1);
  expect(refunds[0].amount).toBe(60000);
  expect(refunds[0].status).toBe('pending');
  expect((await Product.findById(product._id)).stock).toBe(10);
  expect((await Order.findById(order._id)).status).toBe('cancelled');
  await assertReceiptPartition();
});

test('B06 subscription prorated refund retains the rounding remainder and never adds surplus to principal twice', async () => {
  const { user } = await createUser(),
    { user: admin } = await createUser({ role: 'admin' });
  const brand = await createBrand(),
    product = await createProduct(brand, { price: 100002 });
  const box = await combo(product, brand.ownerId);
  const template = await Template.create({
    ownerId: brand.ownerId,
    name: 'Rounding plan',
    boxId: box._id,
    planType: '3_month',
    basePrice: 300006,
    discountPrice: 270005,
    discountPercent: 10,
  });
  const bought = await request(app)
    .post('/api/subcribe-plans/user-subscribe')
    .set(auth(user))
    .set('Idempotency-Key', 'b06-sub-prorated-refund')
    .send({
      templateId: String(template._id),
      expectedTotalAmount: 270005,
      shippingAddress: user.addresses[0].toObject(),
    });
  expect(bought.status).toBe(201);
  const code = bought.body.data.orderCode;
  expect((await webhook(code, 60000)).response.status).toBe(200);
  expect((await Subscription.findById(bought.body.data._id)).status).toBe('pending_payment');
  expect((await webhook(code, 210012)).response.status).toBe(200);
  const sub = await Subscription.findById(bought.body.data._id);
  expect(sub.price).toBe(270005);
  expect(sub.status).toBe('active');
  const service = require('../src/services/subscriptionService');
  await service.createDueFulfillments(service.addMonths(sub.currentPeriodStart, 1));
  const Fulfillment = require('../src/models/SubscriptionFulfillment');
  const job = await Fulfillment.findOne({ subscriptionId: sub._id });
  const dispatch = await request(app)
    .post(`/api/subcribe-plans/fulfillments/${job._id}/dispatch`)
    .set(auth(admin))
    .send({ trackingReference: 'B06-TRACK' });
  expect(dispatch.status).toBe(200);
  const cancel = () =>
    request(app)
      .patch(`/api/subcribe-plans/my-subscriptions/${sub._id}/cancel-immediately`)
      .set(auth(user))
      .send({});
  const beforeDenied = await snapshot();
  expect((await cancel()).status).toBe(409); // A dispatched delivery must finish first.
  expect(await snapshot()).toEqual(beforeDenied);
  for (let retry = 0; retry < 2; retry++)
    expect(
      (
        await request(app)
          .post(`/api/subcribe-plans/fulfillments/${job._id}/deliver`)
          .set(auth(admin))
      ).status,
    ).toBe(200);
  for (let retry = 0; retry < 2; retry++) expect((await cancel()).status).toBe(200);
  const cancelled = await Subscription.findById(sub._id),
    refunds = await Refund.find({
      checkoutId: (await Checkout.findOne({ paymentCode: code }))._id,
    });
  expect(cancelled.remainDeliveries).toBe(2);
  expect(cancelled.completeDeliveries).toBe(1);
  expect(cancelled.refundAmount).toBe(180003); // floor(270005 * 2 / 3), integer VND.
  expect(
    sum(
      refunds.filter((r) => r.purpose === 'subscription'),
      'amount',
    ),
  ).toBe(180003);
  expect(
    sum(
      refunds.filter((r) => r.purpose === 'surplus'),
      'amount',
    ),
  ).toBe(7);
  expect(90002 + sum(refunds, 'amount')).toBe(270012); // Retained delivered value includes the 1-VND floor remainder.
  expect(refunds.every((r) => r.status === 'pending')).toBe(true);
  expect((await Product.findById(product._id)).stock).toBe(9);
  expect((await Box.findById(box._id)).stock).toBe(9);
  await assertReceiptPartition();
});

test('B06 endpoint-specific admin/merchant ownership rejects foreign and legacy mixed edits without business writes', async () => {
  const { user: merchant } = await createUser({ role: 'merchant' }),
    { user: other } = await createUser({ role: 'merchant' });
  const { user: admin } = await createUser({ role: 'admin' });
  const product = await createProduct(await createBrand({ ownerId: merchant._id }));
  const foreign = await createProduct(await createBrand({ ownerId: other._id }));
  const box = await combo(product, merchant._id);
  for (const [url, actor, body, status] of [
    [`/api/manager/products/${product._id}`, other, { name: 'Foreign edit' }, 404],
    [`/api/manager/products/${product._id}`, admin, { name: 'Admin at merchant route' }, 403],
    [`/api/manager/combos/${box._id}`, other, { name: 'Foreign combo edit' }, 404],
    [
      `/api/manager/combos/${box._id}`,
      merchant,
      { products: [{ productId: String(foreign._id), quantity: 1 }] },
      403,
    ],
    [`/api/boxes/update-box/${box._id}`, merchant, { name: 'Merchant at admin route' }, 403],
    [
      `/api/boxes/update-box/${box._id}`,
      admin,
      { products: [{ productId: String(foreign._id), quantity: 1 }] },
      409,
    ],
  ]) {
    const before = await snapshot();
    expect((await request(app).put(url).set(auth(actor)).send(body)).status).toBe(status);
    expect(await snapshot()).toEqual(before);
  }
  const beforeCreate = await snapshot();
  expect(
    (
      await request(app)
        .post('/api/manager/combos')
        .set(auth(merchant))
        .send({
          name: 'Foreign composition',
          descriptions: 'Fixture',
          stock: 10,
          validTo: '2099-01-01T00:00:00Z',
          products: [{ productId: String(foreign._id), quantity: 1 }],
        })
    ).status,
  ).toBe(403);
  expect(await snapshot()).toEqual(beforeCreate);
  expect(
    (
      await request(app)
        .put(`/api/boxes/update-box/${box._id}`)
        .set(auth(admin))
        .send({ name: 'Valid admin edit' })
    ).status,
  ).toBe(200);
  await Box.collection.updateOne(
    { _id: box._id },
    {
      $push: {
        products: { productId: foreign._id, quantity: 1, price: foreign.price, name: foreign.name },
      },
    },
  );
  for (const [url, actor] of [
    [`/api/boxes/update-box/${box._id}`, admin],
    [`/api/manager/combos/${box._id}`, merchant],
  ]) {
    const before = await snapshot();
    expect(
      (await request(app).put(url).set(auth(actor)).send({ name: 'Cannot legitimize legacy' }))
        .status,
    ).toBe(409);
    expect(await snapshot()).toEqual(before);
  }
});

test('B06 pinned subscription and product obligations survive catalog/profile drift and foreign user denial', async () => {
  const { user } = await createUser(),
    { user: stranger } = await createUser();
  const brand = await createBrand(),
    product = await createProduct(brand);
  const box = await combo(product, brand.ownerId);
  const template = await Template.create({
    ownerId: brand.ownerId,
    name: 'Snapshot plan',
    boxId: box._id,
    planType: '3_month',
    basePrice: 300000,
    discountPrice: 300000,
  });
  const bought = await request(app)
    .post('/api/subcribe-plans/user-subscribe')
    .set(auth(user))
    .set('Idempotency-Key', 'b06-sub-snapshot-key')
    .send({ templateId: String(template._id), shippingAddress: user.addresses[0].toObject() });
  expect(bought.status).toBe(201);
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
  const purchased = await request(app)
    .post('/api/checkout/check-out')
    .set(auth(user))
    .set('Idempotency-Key', 'b06-order-snapshot-key')
    .send({ addressId: String(user.addresses[0]._id), paymentMethod: 'online' });
  expect(purchased.status).toBe(201);
  const sub = await Subscription.findById(bought.body.data._id).lean(),
    order = await Order.findById(purchased.body.data.orderId).lean();
  const version = await Version.findById(sub.boxVersionId).lean();
  await Product.updateOne({ _id: product._id }, { price: 999999, name: 'Changed live product' });
  await require('../src/models/User').updateOne(
    { _id: user._id },
    { $set: { 'addresses.0.address': 'Changed live address' } },
  );
  // Raw fixture simulates an external legacy writer; runtime guards reject editing obligated boxes.
  await Box.collection.updateOne(
    { _id: box._id },
    { $set: { value: 999999, 'products.0.quantity': 9 } },
  );
  await require('../src/models/Brand').updateOne({ _id: brand._id }, { ownerId: stranger._id });
  expect(await Subscription.findById(sub._id).lean()).toEqual(sub);
  expect(await Order.findById(order._id).lean()).toEqual(order);
  expect(await Version.findById(version._id).lean()).toEqual(version);
  for (const [method, url, status] of [
    ['get', `/api/subcribe-plans/my-subscriptions/${sub._id}`, 404],
    ['patch', `/api/subcribe-plans/my-subscriptions/${sub._id}/cancel-immediately`, 404],
    ['post', `/api/checkout/cancel/${order._id}`, 403],
  ]) {
    const before = await snapshot();
    expect((await request(app)[method](url).set(auth(stranger)).send({})).status).toBe(status);
    expect(await snapshot()).toEqual(before);
  }
  expect(new mongoose.Types.ObjectId(order.merchantId).equals(brand.ownerId)).toBe(true);
  expect(order.products[0].totalPrice).toBe(100000);
  expect(sub.price).toBe(300000);
  expect(version.definition.products[0].quantity).toBe(1);
});
