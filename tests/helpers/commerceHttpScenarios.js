const mongoose = require('mongoose');
const {
  createUser,
  createProduct,
  createCartWithItems,
  createCoupon,
  signToken,
} = require('./factories');
const Checkout = require('../../src/models/Checkout');
const Attempt = require('../../src/models/CheckoutAttempt');
const Product = require('../../src/models/Product');
const Cart = require('../../src/models/Cart');
const Coupon = require('../../src/models/Coupon');
const Order = require('../../src/models/Order');
const Subscription = require('../../src/models/UserSubscription');
const Box = require('../../src/models/Box');
const Template = require('../../src/models/SubscriptionTemplate');

async function fixture(kind) {
  const { user } = await createUser();
  const { user: merchant } = await createUser({ role: 'merchant' });
  const fixtureSlug = require('node:crypto').randomUUID();
  const brand = await require('../../src/models/Brand').create({
    name: 'B06 fixture ' + fixtureSlug,
    slug: fixtureSlug,
    ownerId: merchant._id,
  });
  const product = await createProduct(brand, { stock: 100 });
  const coupon = await createCoupon({ discountType: 'fixed', discount: 1 });
  let body, path;
  if (kind === 'products') {
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    body = {
      addressId: String(user.addresses[0]._id),
      paymentMethod: 'cod',
      couponCode: coupon.code,
    };
    path = '/api/checkout/check-out';
  } else {
    const box = await Box.create({
      ownerId: brand.ownerId,
      name: 'B06 pinned box',
      stock: 100,
      descriptions: 'Disposable fixture',
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 86400000),
      products: [{ productId: product._id, quantity: 1, name: product.name, price: product.price }],
      value: 100000,
    });
    const template = await Template.create({
      ownerId: brand.ownerId,
      name: 'B06 plan',
      boxId: box._id,
      planType: '3_month',
      basePrice: 300000,
      discountPrice: 300000,
      discountPercent: 0,
    });
    body = {
      templateId: String(template._id),
      expectedTotalAmount: 300000,
      shippingAddress: {
        address: 'Fixture street',
        district: 'Fixture district',
        city: 'Fixture city',
        country: 'VN',
        phone: '0900000000',
      },
    };
    path = '/api/subcribe-plans/user-subscribe';
  }
  return { user, product, coupon, body, path };
}
async function businessSnapshot() {
  // Keep values only in RAM; report no customer fields, tokens or request data.
  const names = [
    'Checkout',
    'Order',
    'UserSubscription',
    'Product',
    'Coupon',
    'Cart',
    'Box',
    'BoxVersion',
    'PaymentEvent',
    'PaymentAllocation',
    'ReceiptRefund',
    'PaymentAudit',
    'NotificationOutbox',
  ];
  return Promise.all(
    names
      .filter((name) => mongoose.models[name])
      .map((name) => mongoose.model(name).find().sort({ _id: 1 }).lean()),
  );
}

module.exports = function register({ urls, children, startBackend, command, record }) {
  const event = (index, expected) =>
    new Promise((resolve, reject) => {
      const child = children[index];
      const listener = (value) => {
        if (value === expected) {
          clearTimeout(timer);
          child.off('message', listener);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        child.off('message', listener);
        reject(new Error('Commerce fixture barrier deadline'));
      }, 10000);
      child.on('message', listener);
    });
  async function send(index, user, path, key, body, method = 'POST') {
    const response = await fetch(urls[index] + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + signToken(user),
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, body: await response.json() };
  }
  const create = (index, f, key, body = f.body) => send(index, f.user, f.path, key, body);
  const terminate = (index, f, key) =>
    send(index, f.user, `/api/checkout/attempts/${f.kind}/${key}/terminate-with-body`, key, f.body);
  async function assertObligations(f, expected) {
    expect(await Checkout.countDocuments({ userId: f.user._id })).toBe(expected);
    expect(await Attempt.countDocuments({ userId: f.user._id, state: 'created' })).toBe(expected);
    expect(await Order.countDocuments({ userId: f.user._id })).toBe(
      f.kind === 'products' ? expected : 0,
    );
    expect(await Subscription.countDocuments({ userId: f.user._id })).toBe(
      f.kind === 'subscription' ? expected : 0,
    );
    expect((await Product.findById(f.product._id)).stock).toBe(
      f.kind === 'products' ? 100 - expected : 100,
    );
    expect((await Coupon.findById(f.coupon._id)).usedCount).toBe(
      f.kind === 'products' ? expected : 0,
    );
  }
  test.each(['products', 'subscription'])(
    'B06 %s two-process fenced concurrency, namespace isolation and independent purchases',
    async (kind) => {
      const f = { ...(await fixture(kind)), kind },
        key = `b06-concurrent-${kind}-key`;
      const prepared = await send(0, f.user, `/api/checkout/attempts/${kind}/prepare`, key, f.body);
      expect(prepared.status).toBe(200);
      await command(0, 'arm-commerce-fence', 'commerce-fence-armed');
      await command(1, 'observe-commerce-fence', 'commerce-observer-armed');
      const held = event(0, 'commerce-fence-held');
      const first = create(0, f, key);
      await held;
      const entered = event(1, 'commerce-fence-entered');
      const second = create(1, f, key);
      try {
        await entered;
      } finally {
        await command(0, 'release-commerce-fence', 'commerce-fence-released');
      }
      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0].body.data).toEqual(results[1].body.data);
      await assertObligations(f, 1);
      const before = await businessSnapshot();
      const changed =
        kind === 'products'
          ? { ...f.body, note: 'different purchase intent' }
          : { ...f.body, expectedTotalAmount: 300001 };
      expect((await create(1, f, key, changed)).status).toBe(409);
      expect(await businessSnapshot()).toEqual(before);
      const ended = await terminate(1, f, key);
      expect(ended.status).toBe(200);
      expect(ended.body.data).toMatchObject({
        state: 'created',
        canRestart: false,
        result: results[0].body.data,
      });
      await assertObligations(f, 1);
      // An existing Checkout key is global within a user; a different kind must conflict.
      const otherKind = kind === 'products' ? 'subscription' : 'products';
      const other = { ...(await fixture(otherKind)), kind: otherKind };
      const crossBody =
        otherKind === 'products'
          ? { ...other.body, addressId: String(f.user.addresses[0]._id) }
          : other.body;
      const crossBefore = await businessSnapshot();
      expect((await send(1, f.user, other.path, key, crossBody)).status).toBe(409);
      expect(await businessSnapshot()).toEqual(crossBefore);
      // Same key in another authenticated user's namespace is an independent purchase.
      const foreign = await create(1, other, key);
      expect(foreign.status).toBe(201);
      expect(foreign.body.data.orderCode).not.toBe(results[0].body.data.orderCode);
      const foreignLookup = await fetch(urls[1] + `/api/checkout/attempts/${kind}/${key}`, {
        headers: {
          Authorization: 'Bearer ' + signToken(other.user),
          'Attempt-Payload-Hash': prepared.body.data.hash,
        },
        signal: AbortSignal.timeout(5000),
      });
      expect(foreignLookup.status).toBe(409); // The other user's committed different kind; never return f's result.
      for (let n = 2; n <= 3; n++) {
        if (kind === 'products')
          await Cart.findOneAndUpdate(
            { userId: f.user._id, isSubscribeCart: false },
            { $set: { items: [{ productId: f.product._id, quantity: 1 }], totalPrice: 0 } },
            { upsert: true },
          );
        const fresh = await create(n % 2, f, `b06-independent-${kind}-${n}`);
        expect(fresh.status).toBe(201);
        expect(fresh.body.data.orderCode).not.toBe(results[0].body.data.orderCode);
        expect((await create(1, f, key)).body.data).toEqual(results[0].body.data);
        await assertObligations(f, n);
      }
      record(`concurrency-isolation-${kind}`, {
        processes: 2,
        barrier: 'attempt write held / other process entered lock',
        purchases: 3,
        noMutationOnMismatch: true,
      });
    },
    45000,
  );
  test.each(['products', 'subscription'])(
    'B06 %s commit with lost HTTP response recovers after process restart; tombstone fences late create',
    async (kind) => {
      const f = { ...(await fixture(kind)), kind },
        key = `b06-lost-response-${kind}`;
      await command(0, 'arm-commerce-response-loss', 'commerce-response-loss-armed');
      const committed = event(0, 'commerce-committed-response-dropped');
      const lost = await create(0, f, key).then(
        () => false,
        () => true,
      );
      await committed;
      expect(lost).toBe(true);
      const checkout = await Checkout.findOne({ userId: f.user._id, requestKey: key });
      expect(checkout).toBeTruthy();
      await assertObligations(f, 1);
      const dead = children[0];
      await new Promise((resolve) => {
        dead.once('exit', resolve);
        dead.kill('SIGKILL');
      });
      await startBackend(0);
      expect(children[0].pid !== dead.pid).toBe(true);
      for (const index of [1, 0]) {
        const recovered = await create(index, f, key);
        expect(recovered.status).toBe(201);
        expect(recovered.body.data).toEqual(JSON.parse(JSON.stringify(checkout.result)));
      }
      await assertObligations(f, 1);
      const tombstone = `b06-terminated-${kind}`;
      const before = await businessSnapshot();
      const ended = await terminate(1, f, tombstone);
      expect(ended.body.data).toMatchObject({ state: 'invalidated', canRestart: true });
      expect((await create(0, f, tombstone)).status).toBe(409);
      expect((await terminate(0, f, tombstone)).body.data).toMatchObject({
        state: 'invalidated',
        canRestart: true,
      });
      expect(await businessSnapshot()).toEqual(before);
      expect(
        await Attempt.countDocuments({ userId: f.user._id, key: tombstone, state: 'invalidated' }),
      ).toBe(1);
      record(`lost-response-restart-tombstone-${kind}`, {
        lostHttpResponseAfterCommit: true,
        mongoUnknownCommitResult: false,
        pidChanged: true,
        tombstoneOnlyWrite: true,
      });
    },
    45000,
  );
};
