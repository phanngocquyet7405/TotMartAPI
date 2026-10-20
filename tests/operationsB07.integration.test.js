const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const http = require('node:http');
const { sha256 } = require('../scripts/evidence-manifest');
const mongoose = require('mongoose');
require('../src/app');
const { disposableMongo } = require('./helpers/disposableMongo');
const { disposableRedis } = require('./helpers/disposableRedis');
const {
  createUser,
  createBrand,
  createProduct,
  createCartWithItems,
  createCoupon,
  signToken,
} = require('./helpers/factories');
const Checkout = require('../src/models/Checkout'),
  Order = require('../src/models/Order');
const Event = require('../src/models/PaymentEvent'),
  Allocation = require('../src/models/PaymentAllocation');
const Refund = require('../src/models/ReceiptRefund'),
  Attempt = require('../src/models/CheckoutAttempt');
const Outbox = require('../src/models/NotificationOutbox'),
  Security = require('../src/models/SecurityOutbox');
let mongo,
  redis,
  observer,
  children = [],
  urls = [],
  fixture,
  sink,
  sinkUrl;
let halted = false;
function drill(name, work, timeout) {
  test(
    name,
    async () => {
      if (halted) throw new Error('B07 halted after previous drill failure');
      try {
        await work();
      } catch (error) {
        halted = true;
        throw error;
      }
    },
    timeout,
  );
}
const resources = {},
  evidence = [];
const securityDeliveries = new Map();
const output = process.env.B07_RESOURCE_FILE
  ? path.dirname(process.env.B07_RESOURCE_FILE)
  : 'artifacts/b07/local';
function record(scenario, values) {
  evidence.push({ scenario, ...values });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'b07-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
function resource(key, value) {
  resources[key] = value;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'b07-resources.json'),
    JSON.stringify(resources, null, 2) + '\n',
  );
}
const poll = async (fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('B07 condition deadline');
};
const event = (index, name) =>
  new Promise((resolve, reject) => {
    const child = children[index];
    const timer = setTimeout(() => {
      child.off('message', receive);
      reject(new Error('B07 event deadline'));
    }, 15000);
    function receive(value) {
      if (value.event === name) {
        clearTimeout(timer);
        child.off('message', receive);
        resolve();
      }
    }
    child.on('message', receive);
  });
async function command(index, action, worker) {
  const id = crypto.randomUUID(),
    child = children[index];
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', onExit);
    }
    function onExit() {
      cleanup();
      reject(new Error('B07 owned child exited'));
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('B07 worker command deadline'));
    }, 30000);
    function receive(value) {
      if (value.id === id) {
        cleanup();
        value.ok ? resolve(value.metrics) : reject(new Error('B07 worker command failed'));
      }
    }
    child.on('message', receive);
    child.once('exit', onExit);
    child.send({ id, action, worker });
  });
}
async function start(index, database = mongo.database) {
  mongo.verify();
  const child = fork(require.resolve('./helpers/operations-process'), [], {
    env: {
      ...process.env,
      MONGODB_URI: mongo.uri(database),
      REDIS_URL: redis.url,
      REDIS_NAMESPACE: 'b07:' + mongo.database,
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  children[index] = child;
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('B07 child start deadline')), 20000);
    child.on('message', function receive(value) {
      if (value.port) {
        clearTimeout(timer);
        child.off('message', receive);
        resolve(value.port);
      } else if (value.startupFailed) {
        clearTimeout(timer);
        reject(new Error('B07 child startup failed'));
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('B07 child spawn failed'));
    });
  });
  urls[index] = 'http://127.0.0.1:' + port;
}
async function stop(index, kill = false) {
  const child = children[index];
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (kill) child.kill('SIGKILL');
    else child.send({ action: 'stop' });
  });
}
async function call(
  index,
  url,
  user = fixture.user,
  body,
  method = body === undefined ? 'GET' : 'POST',
  key,
) {
  const response = await fetch(urls[index] + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + signToken(user),
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function business() {
  const names = [
    'Checkout',
    'Order',
    'UserSubscription',
    'Product',
    'Coupon',
    'PaymentEvent',
    'PaymentAllocation',
    'ReceiptRefund',
    'PaymentAudit',
    'CheckoutAttempt',
    'BoxVersion',
  ];
  const result = {};
  for (const name of names)
    result[name] = await mongoose.model(name).find().sort({ _id: 1 }).lean();
  return result;
}
const sha = (value) =>
  crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : mongoose.mongo.BSON.EJSON.stringify(value))
    .digest('hex');
let receiptId = 700000;
async function pay(index, code, amount, id = ++receiptId) {
  const response = await fetch(urls[index] + '/api/checkout/sepay-webhook', {
    method: 'POST',
    headers: {
      Authorization: 'Apikey ' + process.env.SEPAY_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id,
      gateway: 'FixtureBank',
      transactionDate: '2026-10-20 00:00:00',
      accountNumber: process.env.SEPAY_BANK_ACCOUNT,
      code,
      content: code,
      transferType: 'in',
      transferAmount: amount,
      referenceCode: 'B07-' + id,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  if (process.env.TEST_MONGODB_URI) throw new Error('B07 refuses ambient Mongo target');
  mongo = await disposableMongo((value) => resource('mongo', value));
  redis = await disposableRedis({
    purpose: 'b07',
    onEvidence: (value) => resource('redis', value),
  });
  observer = require('redis').createClient({ url: redis.url });
  observer.on('error', () => {});
  await observer.connect();
  await observer.subscribe('b07:' + mongo.database + ':security', (raw) => {
    const event = JSON.parse(raw);
    securityDeliveries.set(event.eventId, (securityDeliveries.get(event.eventId) || 0) + 1);
  });
  mongo.verify();
  await mongoose.connect(mongo.uri(mongo.database));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  await start(0);
  await start(1);
  const { user, plainPassword } = await createUser(),
    { user: admin } = await createUser({ role: 'admin' }),
    brand = await createBrand(),
    product = await createProduct(brand, { stock: 100 }),
    coupon = await createCoupon({ discountType: 'fixed', discount: 1 });
  fixture = {
    user,
    plainPassword,
    admin,
    brand,
    product,
    coupon,
    body: {
      addressId: String(user.addresses[0]._id),
      paymentMethod: 'online',
      couponCode: coupon.code,
    },
  };
  await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
}, 120000);
afterAll(async () => {
  try {
    for (let i = 0; i < children.length; i++) await stop(i);
  } finally {
    try {
      if (sink) await new Promise((resolve) => sink.close(resolve));
      if (observer?.isOpen) observer.destroy();
      await mongoose.disconnect();
    } finally {
      try {
        await mongo?.cleanup();
      } finally {
        redis?.cleanup();
      }
    }
  }
});

drill(
  'B07 Mongo pause over HTTP fails finitely and same-key recovery preserves business data',
  async () => {
    const key = 'b07-mongo-recovery-key';
    expect(
      (
        await call(
          0,
          '/api/checkout/attempts/products/prepare',
          fixture.user,
          fixture.body,
          'POST',
          key,
        )
      ).status,
    ).toBe(200);
    const before = await business(),
      started = Date.now();
    const results = [];
    try {
      mongo.action('pause');
      for (const url of ['/api/home/health', '/api/users/me']) {
        const response = await call(0, url).catch(() => ({ status: 0 }));
        results.push(response.status);
        expect(response.status >= 200 && response.status < 300).toBe(false);
      }
      const failed = await call(
        1,
        '/api/checkout/check-out',
        fixture.user,
        fixture.body,
        'POST',
        key,
      ).catch(() => ({ status: 0 }));
      results.push(failed.status);
      expect(failed.status >= 200 && failed.status < 300).toBe(false);
    } finally {
      mongo.action('unpause');
    }
    await poll(async () => (await call(0, '/api/home/health')).status === 200);
    await poll(async () => (await call(1, '/api/home/health')).status === 200);
    expect(await business()).toEqual(before); // Also detects a late write after failed/aborted HTTP.
    const created = await call(
      1,
      '/api/checkout/check-out',
      fixture.user,
      fixture.body,
      'POST',
      key,
    );
    expect(created.status).toBe(201);
    expect(
      (await call(0, '/api/checkout/check-out', fixture.user, fixture.body, 'POST', key)).body.data,
    ).toEqual(created.body.data);
    expect(await Checkout.countDocuments({ userId: fixture.user._id })).toBe(1);
    expect(await Order.countDocuments({ userId: fixture.user._id })).toBe(1);
    expect((await require('../src/models/Coupon').findById(fixture.coupon._id)).usedCount).toBe(1);
    const resolved = await call(
      0,
      `/api/checkout/attempts/products/${key}/terminate-with-body`,
      fixture.user,
      fixture.body,
    );
    expect(resolved.body.data).toMatchObject({ state: 'created', canRestart: false });
    record('mongo-single-node-outage', {
      statuses: results,
      elapsedMs: Date.now() - started,
      before: sha(before),
      noLateBusinessWrite: true,
      replayCreated: true,
      fixtureSocketTimeoutMs: 3000,
      fixtureSelectionTimeoutMs: 2000,
      multiNodeFailover: false,
    });
  },
  60000,
);

drill(
  'B07 real server UnknownTransactionCommitResult label retries commit without duplicate obligation',
  async () => {
    const Cart = require('../src/models/Cart');
    await Cart.findOneAndUpdate(
      { userId: fixture.user._id, isSubscribeCart: false },
      { $set: { items: [{ productId: fixture.product._id, quantity: 1 }], totalPrice: 0 } },
      { upsert: true },
    );
    const key = 'b07-server-unknown-commit';
    expect(
      (
        await call(
          0,
          '/api/checkout/attempts/products/prepare',
          fixture.user,
          fixture.body,
          'POST',
          key,
        )
      ).status,
    ).toBe(200);
    const observed = event(0, 'mongo-unknown-commit-observed');
    try {
      await mongo.failpoint({
        mode: { times: 1 },
        data: {
          failCommands: ['commitTransaction'],
          errorCode: 91,
          errorLabels: ['UnknownTransactionCommitResult'],
        },
      });
      const created = await call(
        0,
        '/api/checkout/check-out',
        fixture.user,
        fixture.body,
        'POST',
        key,
      );
      expect(created.status).toBe(201);
      await observed;
      expect(
        (await call(1, '/api/checkout/check-out', fixture.user, fixture.body, 'POST', key)).body
          .data,
      ).toEqual(created.body.data);
      expect(await Checkout.countDocuments({ userId: fixture.user._id, requestKey: key })).toBe(1);
    } finally {
      await mongo.failpoint({ mode: 'off' });
    }
    record('mongo-injected-unknown-commit', {
      serverFailpoint: true,
      driverObservedLabel: true,
      postCommitLostAck: false,
      duplicates: 0,
    });
  },
  45000,
);

drill(
  'B07 failed Redis-backed mutations have no late business write after stop/pause recovery',
  async () => {
    const bystander = require('redis').createClient({
      url: process.env.TEST_REDIS_URL,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    bystander.on('error', () => {});
    await bystander.connect();
    expect(new URL(process.env.TEST_REDIS_URL).port).not.toBe(new URL(redis.url).port);
    const observations = [];
    try {
      for (const fault of ['pause', 'stop']) {
        const before = await business(),
          t = Date.now();
        try {
          redis.action(fault);
          await poll(async () => (await call(0, '/api/home/health')).status === 503, 10000);
          expect(
            (
              await call(
                1,
                '/api/checkout/check-out',
                fixture.user,
                fixture.body,
                'POST',
                'b07-redis-error-' + fault,
              )
            ).status,
          ).toBe(503);
          expect(await bystander.ping()).toBe('PONG');
        } finally {
          redis.action(fault === 'pause' ? 'unpause' : 'start');
        }
        await poll(async () => (await call(0, '/api/home/health')).status === 200);
        await poll(async () => (await call(1, '/api/home/health')).status === 200);
        expect(await business()).toEqual(before);
        observations.push({
          fault,
          status: 503,
          elapsedMs: Date.now() - t,
          noLateBusinessWrite: true,
        });
      }
    } finally {
      if (bystander.isOpen) bystander.destroy();
    }
    record('redis-mutation-outage', {
      observations,
      otherOwnedFixturePong: true,
      familySseEvidence:
        'same final snapshot existing Redis HTTP suite; not a second independent family experiment',
    });
  },
  60000,
);

drill(
  'B07 payment and delivery schedulers recover controlled transaction failure without premature fulfillment',
  async () => {
    const Box = require('../src/models/Box'),
      Template = require('../src/models/SubscriptionTemplate'),
      Sub = require('../src/models/UserSubscription'),
      Fulfillment = require('../src/models/SubscriptionFulfillment');
    const box = await Box.create({
      ownerId: fixture.brand.ownerId,
      name: 'B07 plan box',
      descriptions: 'Fixture',
      stock: 20,
      value: 100000,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 86400000),
      products: [
        { productId: fixture.product._id, quantity: 1, price: 100000, name: 'Fixture part' },
      ],
    });
    const template = await Template.create({
      ownerId: fixture.brand.ownerId,
      name: 'B07 three months',
      boxId: box._id,
      planType: '3_month',
      basePrice: 300000,
      discountPrice: 300000,
    });
    const body = {
      templateId: String(template._id),
      shippingAddress: fixture.user.addresses[0].toObject(),
    };
    const bought = await call(
      0,
      '/api/subcribe-plans/user-subscribe',
      fixture.user,
      body,
      'POST',
      'b07-subscription-backup-key',
    );
    expect(bought.status).toBe(201);
    await Promise.all([command(0, 'drain', 'delivery'), command(1, 'drain', 'delivery')]);
    expect(await Fulfillment.countDocuments()).toBe(0);
    // Corrupt only a fixture allocation target by injecting one controlled DB operation failure in child.
    await command(0, 'fail-payment-once');
    expect((await pay(0, bought.body.data.orderCode, 300007)).status).toBe(200);
    expect(
      await Event.countDocuments({
        paymentCode: bought.body.data.orderCode,
        state: 'retry_required',
        disposition: 'unallocated',
      }),
    ).toBe(1);
    expect((await Sub.findById(bought.body.data._id)).status).toBe('pending_payment');
    await Promise.all([command(0, 'drain', 'payment'), command(1, 'drain', 'payment')]);
    const sub = await Sub.findById(bought.body.data._id);
    expect(sub.status).toBe('active');
    expect(
      await Allocation.countDocuments({
        checkoutId: (await Checkout.findOne({ subscriptionId: sub._id }))._id,
      }),
    ).toBe(1);
    await Sub.updateOne({ _id: sub._id }, { $set: { nextDeliveries: new Date(0) } });
    await command(0, 'fail-delivery-after-upsert');
    await expect(command(0, 'drain', 'delivery')).rejects.toThrow('worker command failed');
    expect(await Fulfillment.countDocuments({ subscriptionId: sub._id })).toBe(1);
    await stop(0, true);
    await start(0);
    await Promise.all([command(0, 'drain', 'delivery'), command(1, 'drain', 'delivery')]);
    expect(await Fulfillment.countDocuments({ subscriptionId: sub._id })).toBe(1);
    expect((await require('../src/models/Product').findById(fixture.product._id)).stock).toBe(100);
    fixture.subscriptionId = String(sub._id);
    await call(
      0,
      '/api/checkout/attempts/products/b07-tombstone-backup/terminate-with-body',
      fixture.user,
      fixture.body,
    );
    record('payment-delivery-workers', {
      instances: 2,
      allocationRolledBackOnFault: true,
      retryDrained: true,
      fulfillmentBeforePaid: 0,
      fulfillmentAfterPaid: 1,
      dispatchAutomatic: false,
      deliveryPostWriteInterruptionRecovered: true,
    });
  },
);

drill(
  'B07 real workers compete, expire claims and recover notification/security transport after process death',
  async () => {
    const checkout = await Checkout.findOne({ requestKey: 'b07-mongo-recovery-key' });
    expect((await pay(0, checkout.paymentCode, 110000)).status).toBe(200);
    await Checkout.updateOne({ _id: checkout._id }, { expiresAt: new Date(0) });
    await Promise.all([command(0, 'drain', 'expiry'), command(1, 'drain', 'expiry')]);
    expect((await Checkout.findById(checkout._id)).state).toBe('paid');
    const pending = await Checkout.findOne({ requestKey: 'b07-server-unknown-commit' });
    await Checkout.updateOne({ _id: pending._id }, { expiresAt: new Date(0) });
    const beforeExpiry = await business();
    await command(0, 'fail-expiry-write-once');
    await command(0, 'drain', 'expiry');
    expect(await business()).toEqual(beforeExpiry);
    await stop(0, true);
    await start(0);
    await Promise.all([command(0, 'drain', 'expiry'), command(1, 'drain', 'expiry')]);
    expect((await Checkout.findById(pending._id)).state).toBe('cancelled');
    const order = await Order.findOne({ paymentCode: checkout.paymentCode });
    await command(0, 'hold-notification-claim');
    const held = event(0, 'notification-claim-held');
    const blocked = command(0, 'drain', 'notification').catch(() => {});
    await held;
    await stop(0, true);
    expect(
      await Outbox.findOne({ state: 'pending', leaseUntil: { $gt: new Date() } }),
    ).toBeTruthy();
    // Controlled clock-expiry fixture, not a claim we waited a natural 60-second lease.
    await Outbox.updateMany(
      { state: 'pending' },
      { $set: { leaseUntil: new Date(0), nextAttempt: new Date(0) } },
    );
    await start(0);
    await command(0, 'fail-notification-publish-once');
    await command(0, 'drain', 'notification');
    expect(await Outbox.countDocuments({ state: 'pending' })).toBeGreaterThan(0);
    await Outbox.updateMany({ state: 'pending' }, { $set: { nextAttempt: new Date(0) } });
    await Promise.all([command(0, 'drain', 'notification'), command(1, 'drain', 'notification')]);
    expect(await Outbox.countDocuments({ state: 'pending' })).toBe(0);
    expect(
      await require('../src/models/Notification').countDocuments({
        eventKey: `${order._id}:payment_received`,
      }),
    ).toBe(1);
    const sec = await Security.create({
      userId: fixture.user._id,
      reason: 'B07 test',
      sessionId: 'fixture-family',
      tokenVersion: 0,
    });
    await command(0, 'hold-security-after-publish');
    const published = event(0, 'security-published-before-marker');
    const secBlocked = command(0, 'drain', 'security').catch(() => {});
    await published;
    await stop(0, true);
    expect((await Security.findById(sec._id)).state).toBe('pending');
    await Security.updateOne({ _id: sec._id }, { $set: { leaseUntil: new Date(0) } });
    await start(0);
    await Promise.all([command(0, 'drain', 'security'), command(1, 'drain', 'security')]);
    expect((await Security.findById(sec._id)).state).toBe('published');
    await poll(() => securityDeliveries.get(String(sec._id)) >= 2);
    await Promise.all([blocked, secBlocked]);
    record('worker-claim-restart', {
      expiryInstances: 2,
      notificationInstances: 2,
      durableNotificationDedup: true,
      securityPublishedBeforeMarker: true,
      claimExpiry: 'fixture sets lease into past',
      transport: 'at-least-once',
      securityTransportDeliveries: securityDeliveries.get(String(sec._id)),
      naturalLeaseWait: false,
      expiryPostWriteTransactionRollback: true,
    });
  },
  90000,
);

drill(
  'B07 alert dispatcher sends redacted firing/recovery, dedups and exposes failed delivery to a local sink',
  async () => {
    const { createDispatcher, httpDelivery } = require('../scripts/dispatch-operations-alerts');
    const seen = new Set(),
      received = [];
    let rejectDelivery = false;
    sink = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (rejectDelivery) {
          res.writeHead(503).end();
          return;
        }
        const key = req.headers['idempotency-key'];
        if (!seen.has(key)) {
          seen.add(key);
          received.push(JSON.parse(raw));
        }
        res.writeHead(204).end();
      });
    });
    await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
    sinkUrl = `http://127.0.0.1:${sink.address().port}`;
    const old = new Date(Date.now() - 2 * 86400000);
    await Event.collection.insertOne({
      referenceCode: 'B07-ALERT-RETRY',
      state: 'retry_required',
      disposition: 'unallocated',
      paymentLedgerVersion: 2,
      transferAmount: 1234,
      payloadHash: 'fixture',
      createdAt: old,
      nextAttempt: new Date('2099-01-01'),
    });
    const alertOutbox = await Outbox.findOne({ state: 'delivered' }),
      alertRefund = await Refund.findOne({ status: 'pending' });
    await Outbox.collection.updateOne(
      { _id: alertOutbox._id },
      {
        $set: {
          state: 'pending',
          createdAt: old,
          leaseUntil: new Date('2099-01-01'),
          nextAttempt: new Date('2099-01-01'),
        },
      },
    );
    await Refund.collection.updateOne({ _id: alertRefund._id }, { $set: { createdAt: old } });
    // Admission capacity fixture, not load generation: durable tombstones remain intact.
    const { user: capacityUser } = await createUser();
    await Attempt.collection.insertMany(
      Array.from({ length: 8000 }, (_, i) => ({
        userId: capacityUser._id,
        kind: 'products',
        key: `b07-capacity-${i}`,
        hash: '0'.repeat(64),
        state: 'invalidated',
        createdAt: old,
      })),
    );
    let clock = Date.now();
    const state = {};
    const dispatcher = createDispatcher({
      readSummary: async () => {
        const r = await call(0, '/api/admin/operations/health-summary', fixture.admin);
        expect(r.status).toBe(200);
        return r.body.data;
      },
      deliver: httpDelivery(sinkUrl),
      state,
      now: () => clock,
      save: async (value) =>
        fs.writeFileSync(path.join(output, 'b07-alert-state.json'), JSON.stringify(value, null, 2)),
    });
    rejectDelivery = true;
    expect((await dispatcher.tick()).deliveryHealthy).toBe(false);
    expect(Object.values(state).some((s) => s.deliveryFailed)).toBe(true);
    rejectDelivery = false;
    expect((await dispatcher.tick()).sent).toBeGreaterThanOrEqual(4);
    const firingCount = received.length;
    expect((await dispatcher.tick()).sent).toBe(0);
    expect(received.length).toBe(firingCount);
    await Attempt.collection.insertMany(
      Array.from({ length: 2000 }, (_, i) => ({
        userId: capacityUser._id,
        kind: 'products',
        key: `b07-capacity-max-${i}`,
        hash: '0'.repeat(64),
        state: 'invalidated',
        createdAt: old,
      })),
    );
    expect(
      (
        await call(
          0,
          '/api/checkout/attempts/products/b07-capacity-denied-key/terminate-with-body',
          capacityUser,
          fixture.body,
        )
      ).status,
    ).toBe(429);
    expect(await Attempt.countDocuments({ userId: capacityUser._id })).toBe(10000);
    expect((await dispatcher.tick()).sent).toBe(0);
    expect(received.map((x) => x.queue)).toEqual(
      expect.arrayContaining([
        'webhookRetries',
        'notificationOutbox',
        'overdueRefunds',
        'attemptCapacity',
      ]),
    );
    for (const payload of received)
      expect(Object.keys(payload).sort()).toEqual(['count', 'observedAt', 'queue', 'status']);
    // Clear alert conditions by resolving only the exact synthetic sentinel rows.
    await Event.updateOne({ referenceCode: 'B07-ALERT-RETRY' }, { $set: { state: 'unmatched' } });
    await Outbox.updateOne(
      { _id: alertOutbox._id },
      { $set: { leaseUntil: new Date(0), nextAttempt: new Date(0) } },
    );
    await command(0, 'drain', 'notification');
    expect(
      (
        await call(
          0,
          `/api/admin/reconciliation/refunds/${alertRefund._id}/complete`,
          fixture.admin,
          {
            amount: alertRefund.amount,
            reference: 'B07-ALERT-REFUND-COMPLETE',
            evidence: 'Synthetic verified bank evidence',
          },
          'POST',
          'b07-alert-refund-completion',
        )
      ).status,
    ).toBe(200);
    // Keep capacity tombstones; recovery is observed from a real summary after threshold disappears in a separate fixture namespace would require archival policy.
    clock += 61000;
    await dispatcher.tick();
    expect(received.filter((x) => x.status === 'recovery').map((x) => x.queue)).toEqual(
      expect.arrayContaining(['webhookRetries', 'notificationOutbox', 'overdueRefunds']),
    );
    record('alerts-local-transport', {
      firingCount,
      recoveryCount: received.filter((x) => x.status === 'recovery').length,
      payloadFields: ['queue', 'status', 'count', 'observedAt'],
      dedup: true,
      deliveryFailureObserved: true,
      capacityRecoveryNotSimulated: true,
      attemptWarningCount: 8000,
      attemptAdmissionCap: 10000,
      admissionAtCapStatus: 429,
    });
  },
);

drill('B07 bounded local route mix preserves new purchase/replay/receipt invariants', async () => {
  const profiles = [];
  const Product = require('../src/models/Product'),
    Coupon = require('../src/models/Coupon');
  for (let n = 0; n < 2; n++) {
    const { user } = await createUser();
    await createCartWithItems(user._id, [{ productId: fixture.product._id, quantity: 1 }]);
    profiles.push({
      user,
      key: `b07-load-purchase-${n}`,
      body: {
        addressId: String(user.addresses[0]._id),
        paymentMethod: 'online',
        couponCode: fixture.coupon.code,
      },
      receipt: ++receiptId,
    });
  }
  const beforeStock = (await Product.findById(fixture.product._id)).stock,
    beforeCoupon = (await Coupon.findById(fixture.coupon._id)).usedCount;
  const connectionBefore = (await mongoose.connection.db.admin().command({ serverStatus: 1 }))
    .connections.current;
  for (let n = 0; n < 4; n++) expect((await call(n % 2, '/api/home/health')).status).toBe(200);
  await Promise.all([command(0, 'metrics'), command(1, 'metrics')]);
  const times = [],
    statuses = {},
    started = Date.now();
  let errors = 0;
  async function measured(fn) {
    const t = Date.now();
    const result = await fn();
    times.push(Date.now() - t);
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    if (result.status < 200 || result.status >= 300) errors++;
    if (errors > 2 || Date.now() - started > 30000) throw new Error('B07 load stop threshold');
    return result;
  }
  // Sixteen browse/quote, four prepare/create, twelve replay, eight duplicate-safe webhook = 40.
  for (let wave = 0; wave < 8; wave++)
    await Promise.all(
      profiles.map((p, i) =>
        measured(() =>
          wave % 2
            ? call(i, '/api/checkout/quote', p.user, {
                items: [{ productId: String(fixture.product._id), quantity: 1 }],
              })
            : call(i, '/api/products/get-all-products', p.user),
        ),
      ),
    );
  await Promise.all(
    profiles.map((p, i) =>
      measured(() =>
        call(i, '/api/checkout/attempts/products/prepare', p.user, p.body, 'POST', p.key),
      ),
    ),
  );
  await Promise.all(
    profiles.map((p, i) =>
      measured(async () => {
        const r = await call(i, '/api/checkout/check-out', p.user, p.body, 'POST', p.key);
        p.result = r.body.data;
        return r;
      }),
    ),
  );
  for (let wave = 0; wave < 6; wave++)
    await Promise.all(
      profiles.map((p, i) =>
        measured(async () => {
          const r = await call(1 - i, '/api/checkout/check-out', p.user, p.body, 'POST', p.key);
          expect(r.body.data).toEqual(p.result);
          return r;
        }),
      ),
    );
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(
      profiles.map((p, i) =>
        measured(() => pay(i, p.result.orderCode, p.result.totalAmount, p.receipt)),
      ),
    );
  expect(errors).toBe(0);
  expect(times).toHaveLength(40);
  for (const p of profiles) {
    const checkout = await Checkout.findOne({ userId: p.user._id, requestKey: p.key });
    expect(checkout.state).toBe('paid');
    expect(await Allocation.countDocuments({ checkoutId: checkout._id })).toBe(1);
    expect(checkout.receivedAmount).toBe(checkout.totalAmount);
    expect(await Order.countDocuments({ userId: p.user._id })).toBe(1);
  }
  expect((await Product.findById(fixture.product._id)).stock).toBe(beforeStock - 2);
  expect((await Coupon.findById(fixture.coupon._id)).usedCount).toBe(beforeCoupon + 2);
  const queryMetrics = await Promise.all([command(0, 'metrics'), command(1, 'metrics')]);
  await Promise.all([command(0, 'drain', 'notification'), command(1, 'drain', 'notification')]);
  expect(await Outbox.countDocuments({ state: 'pending' })).toBe(0);
  const drainMetrics = await Promise.all([command(0, 'metrics'), command(1, 'metrics')]);
  const connectionAfter = (await mongoose.connection.db.admin().command({ serverStatus: 1 }))
    .connections.current;
  times.sort((a, b) => a - b);
  record('bounded-local-load', {
    warmup: 4,
    concurrency: 2,
    samples: times.length,
    requestBudget: 40,
    maxDurationMs: 30000,
    elapsedMs: Date.now() - started,
    p50Ms: times[19],
    p95Ms: times[37],
    statuses,
    errors,
    planned429: 0,
    outage503: 0,
    connectionBefore,
    connectionAfter,
    mongooseQueries: queryMetrics.reduce((n, m) => n + m.queries, 0),
    mongooseDrainQueries: drainMetrics.reduce((n, m) => n + m.queries, 0),
    newPurchases: 2,
    stockDelta: -2,
    couponDelta: 2,
    pendingNotification: 0,
  });
});

drill(
  'B07 quiesced real backup/restore conserves documents/indexes/relations and restored application replay',
  async () => {
    // Remove no business evidence: alert sentinels are tagged synthetic and deliberately outside ledger conservation scope.
    for (let i = 0; i < children.length; i++) await stop(i);
    const loginRes = { cookie() {}, clearCookie() {} };
    const sessionToken = await require('../src/services/sessionService').createSession(
      fixture.user,
      loginRes,
    );
    const source = mongoose.connection.db;
    const collections = await source.listCollections().toArray();
    const inventory = {};
    for (const { name } of collections) {
      inventory[name] = {
        count: await source.collection(name).countDocuments(),
        indexes: await source.collection(name).indexes(),
        fingerprint: sha(await source.collection(name).find().sort({ _id: 1 }).toArray()),
      };
    }
    const marker = await source.collection('b07markers').insertOne({ sequence: 1, quiesced: true });
    inventory.b07markers = {
      count: 1,
      indexes: await source.collection('b07markers').indexes(),
      fingerprint: sha(await source.collection('b07markers').find().toArray()),
    };
    const archive = path.resolve(output, 'b07-fixture.archive.gz');
    const dumpStart = Date.now();
    mongo.dump(archive);
    const dumpMs = Date.now() - dumpStart;
    const archiveBeforeRestoreSha256 = sha256(fs.readFileSync(archive));
    const restoreStart = Date.now(),
      destination = mongo.database + '_restored';
    const destinationDb = mongoose.connection.getClient().db(destination);
    expect(await destinationDb.listCollections().toArray()).toEqual([]);
    const restoreHashes = mongo.restore(destination, archive);
    const archiveAfterRestoreSha256 = sha256(fs.readFileSync(archive));
    expect(archiveAfterRestoreSha256).toBe(archiveBeforeRestoreSha256);
    expect(Object.values(restoreHashes).every((h) => h === archiveBeforeRestoreSha256)).toBe(true);
    const restoreMs = Date.now() - restoreStart;
    const restored = source.client
      ? source.client.db(destination)
      : mongoose.connection.getClient().db(destination);
    for (const [name, expected] of Object.entries(inventory)) {
      expect(await restored.collection(name).countDocuments()).toBe(expected.count);
      const orderedIndexes = (rows) =>
        rows
          .map((index) => ({ ...index, key: Object.entries(index.key) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      expect(orderedIndexes(await restored.collection(name).indexes())).toEqual(
        orderedIndexes(expected.indexes),
      );
      expect(sha(await restored.collection(name).find().sort({ _id: 1 }).toArray())).toBe(
        expected.fingerprint,
      );
    }
    const checkout = await restored
      .collection('checkouts')
      .findOne({ requestKey: 'b07-mongo-recovery-key' });
    expect(
      await restored
        .collection('orders')
        .countDocuments({ _id: { $in: checkout.orderIds }, userId: checkout.userId }),
    ).toBe(checkout.orderIds.length);
    const allocationRows = await restored
      .collection('paymentallocations')
      .find({ checkoutId: checkout._id })
      .toArray();
    expect(allocationRows.reduce((n, a) => n + a.amount, 0)).toBe(checkout.receivedAmount);
    const refunds = await restored
      .collection('receiptrefunds')
      .find({ checkoutId: checkout._id })
      .toArray();
    expect(checkout.totalAmount + refunds.reduce((n, r) => n + r.amount, 0)).toBe(
      checkout.receivedAmount,
    );
    const allEvents = await restored
      .collection('paymentevents')
      .find({ paymentLedgerVersion: 2 })
      .toArray();
    const allAllocations = await restored.collection('paymentallocations').find().toArray();
    const direct = allEvents.filter((e) => ['refund_pending', 'refunded'].includes(e.disposition)),
      unallocated = allEvents.filter((e) => e.disposition === 'unallocated');
    expect(allEvents.reduce((n, e) => n + e.transferAmount, 0)).toBe(
      allAllocations.reduce((n, a) => n + a.amount, 0) +
        [...direct, ...unallocated].reduce((n, e) => n + e.transferAmount, 0),
    );
    for (const c of await restored.collection('checkouts').find().toArray()) {
      expect(
        allAllocations.filter((a) => a.checkoutId.equals(c._id)).reduce((n, a) => n + a.amount, 0),
      ).toBe(c.receivedAmount);
      expect(await restored.collection('users').countDocuments({ _id: c.userId })).toBe(1);
      if (c.subscriptionId) {
        const sub = await restored
          .collection('usersubscriptions')
          .findOne({ _id: c.subscriptionId });
        expect(sub).toBeTruthy();
        expect(
          await restored
            .collection('boxversions')
            .countDocuments({ _id: sub.boxVersionId, boxId: sub.boxId }),
        ).toBe(1);
      }
    }
    expect(
      await restored
        .collection('checkoutattempts')
        .countDocuments({ key: 'b07-tombstone-backup', state: 'invalidated' }),
    ).toBe(1);
    expect(
      await restored
        .collection('b07markers')
        .countDocuments({ _id: marker.insertedId, sequence: 1 }),
    ).toBe(1);
    await start(0, destination);
    const replay = await call(
      0,
      '/api/checkout/check-out',
      fixture.user,
      fixture.body,
      'POST',
      'b07-mongo-recovery-key',
    );
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(checkout.result);
    const sessionAccess = await fetch(urls[0] + '/api/users/me', {
      headers: { Authorization: 'Bearer ' + sessionToken },
      signal: AbortSignal.timeout(10000),
    });
    expect(sessionAccess.status).toBe(200);
    await sessionAccess.arrayBuffer();
    const terminated = await call(
      0,
      '/api/checkout/attempts/products/b07-tombstone-backup/terminate-with-body',
      fixture.user,
      fixture.body,
    );
    expect(terminated.body.data.state).toBe('invalidated');
    expect(
      (await call(0, `/api/subcribe-plans/my-subscriptions/${fixture.subscriptionId}`)).status,
    ).toBe(200);
    await stop(0);
    record('backup-restore', {
      archive: path.basename(archive),
      runId: path.basename(output),
      archiveSha256: sha256(fs.readFileSync(archive)),
      archiveBeforeRestoreSha256,
      archiveAfterRestoreSha256,
      restoreHashes,
      destinationInitiallyEmpty: true,
      archiveBytes: fs.statSync(archive).size,
      collections: Object.keys(inventory).length,
      countsAndIndexes: true,
      relations: true,
      sessionReplay: true,
      dumpMs,
      restoreMs,
      observedRtoMs: Date.now() - restoreStart,
      rtoStart: 'before mongorestore',
      rtoEnd:
        'indexes/documents/ledger verified and destination HTTP replay/session/termination completed',
      rpoAcknowledgedWritesLost: 0,
      consistency: 'writers and worker children quiesced; marker inserted before dump',
      encrypted: false,
      offsite: false,
      pitr: false,
    });
  },
);

drill(
  'B07 migration dry-run, transaction interruption, rerun and CAS rollback preserve writer changes',
  async () => {
    await mongoose.disconnect();
    mongo.verify();
    await mongoose.connect(mongo.uri(mongo.database + '_migration'));
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
    // Clone quiesced source relations/session/ledger into the new migration namespace.
    const sourceDb = mongoose.connection.getClient().db(mongo.database);
    for (const { name } of await sourceDb.listCollections().toArray()) {
      const rows = await sourceDb.collection(name).find().toArray();
      if (rows.length) await mongoose.connection.db.collection(name).insertMany(rows);
    }
    const protectedNames = [
      'Checkout',
      'Order',
      'UserSubscription',
      'PaymentEvent',
      'PaymentAllocation',
      'ReceiptRefund',
      'PaymentAudit',
      'CheckoutAttempt',
      'AuthSession',
      'BoxVersion',
    ];
    const protectedHash = async () =>
      sha(
        await Promise.all(
          protectedNames.map((name) => mongoose.model(name).find().sort({ _id: 1 }).lean()),
        ),
      );
    const protectedBefore = await protectedHash();
    const { user: merchant } = await createUser({ role: 'merchant' }),
      brand = await createBrand({ ownerId: merchant._id }),
      product = await createProduct(brand);
    const Box = require('../src/models/Box');
    const legacy = {
      name: 'B07 legacy flags',
      stock: 10,
      descriptions: 'Synthetic',
      value: 100000,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 86400000),
      products: [{ productId: product._id, quantity: 1, price: 100000, name: 'Fixture' }],
      internalSubscription: true,
    };
    const boxId = (await Box.collection.insertOne(legacy)).insertedId;
    const script = require('../scripts/migrate-commerce-integrity');
    const before = await business(),
      manifest = await script.plan();
    expect(await business()).toEqual(before);
    expect(manifest.changes.length).toBeGreaterThan(0);
    expect(manifest.conflicts).toHaveLength(0);
    const collision = (
      await Box.collection.insertOne({
        ...legacy,
        _id: new mongoose.Types.ObjectId(),
        name: 'B07 flag conflict',
        internalSubscription: true,
        subscriptionOnly: false,
      })
    ).insertedId;
    const conflicted = await script.plan();
    expect(conflicted.conflicts.length).toBeGreaterThan(0);
    const beforeConflict = await business();
    await expect(script.apply(conflicted)).rejects.toThrow(/conflict/i);
    expect(await business()).toEqual(beforeConflict);
    // Remove only the just-created conflict specimen after recording refusal; never repair business legacy by deletion.
    await Box.collection.deleteOne({ _id: collision });
    const reviewed = await script.plan();
    const Collection = mongoose.connection.collection('boxes'),
      original = Collection.updateOne.bind(Collection);
    let calls = 0;
    Collection.updateOne = async (...args) => {
      calls++;
      if (calls === 1) throw new Error('B07 apply interruption');
      return original(...args);
    };
    try {
      await expect(script.apply(reviewed)).rejects.toThrow('B07 apply interruption');
    } finally {
      Collection.updateOne = original;
    }
    expect(await business()).toEqual(before);
    await script.apply(reviewed);
    const applied = await business();
    await expect(script.apply(reviewed)).rejects.toThrow('CAS');
    expect(await business()).toEqual(applied);
    expect((await script.plan()).changes).toHaveLength(0); // Fresh dry-run is idempotent; stale manifest stops safely.
    const writerOwner = new mongoose.Types.ObjectId();
    await require('../src/models/Product').collection.updateOne(
      { _id: product._id },
      { $set: { ownerId: writerOwner } },
    );
    const afterWriter = await business();
    await expect(script.apply(reviewed, true)).rejects.toThrow('CAS');
    expect(await business()).toEqual(afterWriter);
    const safeRollback = {
      ...reviewed,
      changes: reviewed.changes.filter(
        (c) => !(c.collection === 'products' && c.id === String(product._id)),
      ),
    };
    await script.apply(safeRollback, true);
    expect(
      (await require('../src/models/Product').findById(product._id)).ownerId.equals(writerOwner),
    ).toBe(true);
    expect((await Box.collection.findOne({ _id: boxId })).subscriptionOnly).toBeNull(); // Existing manifest represents missing preimage as null; disclosed limitation.
    const identity = require('../scripts/review-user-identity');
    const users = mongoose.connection.db.collection('users');
    await users.insertMany([
      { name: 'Collision A', email: ' Collision@Example.test ' },
      { name: 'Collision B', email: 'collision@example.test' },
    ]);
    const identityBefore = sha(await users.find().sort({ _id: 1 }).toArray()),
      identityPlan = await identity.inspectIdentity(mongoose.connection.db);
    expect(identityPlan.collisionGroups).toHaveLength(1);
    expect(sha(await users.find().sort({ _id: 1 }).toArray())).toBe(identityBefore);
    expect(await protectedHash()).toBe(protectedBefore);
    record('migration-cas', {
      dryRunUnchanged: true,
      conflictsBlocked: true,
      interruptedApplyAtomic: true,
      staleRerunRejectedWithoutMutation: true,
      freshRerunNoChanges: true,
      rollbackWriterConflictPreserved: true,
      safeSubsetRollback: true,
      identityCollisionGroups: 1,
      identityApplyNotRun:
        'existing tool requires its own separate capability; no index-drop workflow in B07',
      missingPreimageRestoredAsNull: true,
      manifestSha256: sha(reviewed),
      changes: reviewed.changes.length,
    });
  },
  60000,
);
