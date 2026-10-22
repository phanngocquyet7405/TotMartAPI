const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { A, F, purchaseFixture } = require('./client');
const stateFile = '/fixture/private-a1-worker.json';
const model = (name) => require('/app/src/models/' + name);
const hash = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const projections = {
  Product: '_id stock',
  Coupon: '_id usedCount',
  Checkout:
    '_id state paymentStatus paymentMethod totalAmount receivedAmount overpaidAmount paymentCode orderIds revision expiresAt',
  Order: '_id paymentCode status paymentStatus stockDeducted stockRestored totalAmount',
  CheckoutAttempt: '_id state revision result',
  PaymentEvent: '_id state disposition transferAmount attempts nextAttempt',
  PaymentAllocation: '_id eventId checkoutId amount',
  ReceiptRefund: '_id eventId checkoutId amount purpose status',
  UserSubscription: '_id status paymentStatus remainDeliveries completeDeliveries nextDeliveries',
  SubscriptionFulfillment: '_id subscriptionId sequence state',
  Notification: '_id eventKey',
  NotificationOutbox: '_id state eventKey attempts leaseUntil nextAttempt',
  SecurityOutbox: '_id state attempts leaseUntil leaseId nextAttempt',
};
async function snapshot() {
  const data = {};
  for (const [name, fields] of Object.entries(projections))
    data[name] = await model(name).find({}, fields).sort({ _id: 1 }).lean();
  return JSON.parse(JSON.stringify(data));
}
async function main() {
  const action = process.argv[2],
    kind = process.argv[3];
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {};
  const result = { action, kind };
  try {
    await A.db.connect();
    if (action === 'watch-security') {
      const redis = require('/app/src/config/redis');
      const subscriber = require('redis').createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 5000, rejectUnauthorized: true },
      });
      subscriber.on('error', () => {
        fs.writeFileSync(
          '/fixture/security-watcher-error.json',
          JSON.stringify({ error: 'fixture-redis-connection' }),
        );
      });
      await subscriber.connect();
      const counts = {};
      await subscriber.subscribe(redis.namespace() + ':security', (raw) => {
        const id = JSON.parse(raw).eventId;
        counts[id] = (counts[id] || 0) + 1;
        fs.writeFileSync('/fixture/security-deliveries.json', JSON.stringify(counts));
      });
      fs.writeFileSync('/fixture/security-watcher-ready.json', JSON.stringify({ ready: true }));
      await new Promise(() => {});
    }
    if (action === 'setup') {
      await A.db.clearDatabase();
      const f = await purchaseFixture(
        kind === 'payment' || kind === 'delivery' ? 'subscription' : 'products',
      );
      if (kind === 'expiry') {
        const coupon = await F.createCoupon({ discountType: 'fixed', discount: 1 });
        f.body.paymentMethod = 'online';
        f.body.couponCode = coupon.code;
      }
      state = { f: JSON.parse(JSON.stringify(f)), kind };
      const bought = await A.http(0, f.path, 'POST', f.body, {
        ...f.auth,
        'Idempotency-Key': f.key,
      });
      assert.equal(bought.status, 201);
      state.result = bought.body.data;
      const checkout = await model('Checkout').findOne({ userId: f.user._id, requestKey: f.key });
      state.checkoutId = String(checkout._id);
      state.code = checkout.paymentCode;
      if (kind === 'expiry')
        await model('Checkout').updateOne({ _id: checkout._id }, { expiresAt: new Date(0) });
      if (kind === 'notification') {
        const until = Date.now() + 10000;
        while (await model('NotificationOutbox').countDocuments({ state: 'pending' })) {
          assert(Date.now() < until, 'Initial COD notification must drain before target event');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const order = await model('Order').findOne({ paymentCode: state.code });
        state.eventKey = String(order._id) + ':order_cancelled';
        await model('NotificationOutbox').create({
          eventKey: state.eventKey,
          orderId: order._id,
          type: 'order_cancelled',
        });
      }
      if (kind === 'security') {
        const event = await model('SecurityOutbox').create({
          userId: f.user._id,
          reason: 'Fixture worker',
          tokenVersion: 0,
          sessionId: 'fixture-family',
        });
        state.securityId = String(event._id);
      }
      state.before = await snapshot();
    } else if (action === 'pay') {
      const id = 800001;
      const response = await A.http(
        0,
        '/api/checkout/sepay-webhook',
        'POST',
        {
          id,
          gateway: 'FixtureBank',
          transactionDate: '2026-10-21 00:00:00',
          accountNumber: process.env.SEPAY_BANK_ACCOUNT,
          code: state.code,
          content: state.code,
          transferType: 'in',
          transferAmount: 300007,
          referenceCode: 'A1-WORKER-' + id,
        },
        { Authorization: 'Apikey ' + process.env.SEPAY_API_KEY },
      );
      assert.equal(response.status, 200);
      const event = await model('PaymentEvent').findOne({ paymentCode: state.code });
      if (kind === 'payment') {
        assert.equal(event.state, 'retry_required');
        assert.equal(event.disposition, 'unallocated');
        assert.equal(await model('PaymentAllocation').countDocuments(), 0);
        assert.equal(
          (await model('UserSubscription').findById(state.result._id)).status,
          'pending_payment',
        );
      }
    } else if (action === 'paid-check') {
      const sub = await model('UserSubscription').findById(state.result._id);
      assert.equal(sub.status, 'active');
      assert.equal(sub.paymentStatus, 'paid');
      const allocation = await model('PaymentAllocation').find({ checkoutId: state.checkoutId });
      assert.equal(allocation.length, 1);
      assert.equal(allocation[0].amount, 300007);
      const refund = await model('ReceiptRefund').find({ checkoutId: state.checkoutId });
      assert.equal(refund.length, 1);
      assert.equal(refund[0].amount, 7);
      assert.equal(refund[0].status, 'pending');
      assert.equal(refund[0].purpose, 'surplus');
      const checkout = await model('Checkout').findById(state.checkoutId);
      const receipt = await model('PaymentEvent').findOne({ paymentCode: state.code });
      assert.equal(receipt.transferAmount, allocation[0].amount);
      assert.equal(checkout.receivedAmount, allocation[0].amount);
      assert.equal(checkout.totalAmount, 300000);
      assert.equal(allocation[0].amount, checkout.totalAmount + refund[0].amount);
      assert.equal(await model('ReceiptRefund').countDocuments({ status: 'completed' }), 0);
      assert.equal(await model('PaymentEvent').countDocuments({ disposition: 'unallocated' }), 0);
      if (kind === 'delivery')
        await model('UserSubscription').updateOne(
          { _id: sub._id },
          { nextDeliveries: new Date(0) },
        );
    } else if (action === 'unpaid-delivery-check') {
      assert.equal(await model('SubscriptionFulfillment').countDocuments(), 0);
    } else if (action === 'expiry-rollback-check') {
      const current = await snapshot();
      assert.deepEqual(current, state.before);
    } else if (action === 'expiry-check') {
      assert.equal((await model('Checkout').findById(state.checkoutId)).state, 'cancelled');
      assert.equal(
        await model('Order').countDocuments({ paymentCode: state.code, status: 'cancelled' }),
        1,
      );
      assert.equal((await model('Coupon').findOne()).usedCount, 0);
      assert.equal((await model('Product').findById(state.f.product._id)).stock, 100);
      assert.equal(await model('PaymentAllocation').countDocuments(), 0);
    } else if (action === 'delivery-check') {
      assert.equal(
        await model('SubscriptionFulfillment').countDocuments({ subscriptionId: state.result._id }),
        1,
      );
      assert.equal((await model('SubscriptionFulfillment').findOne()).state, 'pending');
      assert.equal((await model('Product').findById(state.f.product._id)).stock, 100);
      assert.equal(
        await model('PaymentAllocation').countDocuments({ checkoutId: state.checkoutId }),
        1,
      );
    } else if (action === 'notification-held-check') {
      const event = await model('NotificationOutbox').findOne({ eventKey: state.eventKey });
      assert.equal(event.state, 'pending');
      assert(event.leaseUntil > new Date());
      result.leaseUntil = event.leaseUntil.getTime();
      result.recordId = String(event._id);
    } else if (action === 'notification-backoff-check') {
      const event = await model('NotificationOutbox').findOne({ eventKey: state.eventKey });
      assert.equal(event.state, 'pending');
      assert(event.nextAttempt > new Date());
      result.nextAttempt = event.nextAttempt.getTime();
    } else if (action === 'notification-check') {
      assert.equal(await model('NotificationOutbox').countDocuments({ state: 'pending' }), 0);
      assert.equal(await model('Notification').countDocuments({ eventKey: state.eventKey }), 1);
    } else if (action === 'security-held-check') {
      const event = await model('SecurityOutbox').findById(state.securityId);
      assert.equal(event.state, 'pending');
      assert(event.leaseUntil > new Date());
      result.leaseUntil = event.leaseUntil.getTime();
    } else if (action === 'security-check') {
      assert.equal((await model('SecurityOutbox').findById(state.securityId)).state, 'published');
      assert.equal(await model('SecurityOutbox').countDocuments({ state: 'pending' }), 0);
    } else if (action === 'replay-survivor') {
      const response = await A.http(1, state.f.path, 'POST', state.f.body, {
        ...state.f.auth,
        'Idempotency-Key': state.f.key,
      });
      assert.equal(response.status, 201);
      assert.deepEqual(response.body.data, state.result);
      assert.equal(await model('Checkout').countDocuments(), 1);
      assert.equal(await model('Order').countDocuments(), 1);
      assert.equal((await model('Product').findById(state.f.product._id)).stock, 99);
    } else throw Error('Unknown fixture action');
    result.snapshot = await snapshot();
    result.snapshotHash = hash(result.snapshot);
    result.passed = true;
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch (error) {
    result.passed = false;
    result.errorType = error.name;
    result.code = error.code;
    result.assertion = {
      operator: error.operator,
      actual:
        typeof error.actual === 'number' || typeof error.actual === 'boolean'
          ? error.actual
          : undefined,
      expected:
        typeof error.expected === 'number' || typeof error.expected === 'boolean'
          ? error.expected
          : undefined,
    };
    try {
      result.failureSnapshot = await snapshot();
    } catch (snapshotError) {
      result.snapshotError = { type: snapshotError.name, code: snapshotError.code };
    }
  } finally {
    await A.db.closeDatabase();
    console.log('A1_WORKER_RESULT=' + JSON.stringify(result));
  }
}
main().catch(() => {
  process.exitCode = 1;
});
