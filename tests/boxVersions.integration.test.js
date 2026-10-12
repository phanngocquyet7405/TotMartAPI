const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct } = require('./helpers/factories');
const Box = require('../src/models/Box');
const BoxVersion = require('../src/models/BoxVersion');
const Subscription = require('../src/models/UserSubscription');
const Template = require('../src/models/SubscriptionTemplate');
const Fulfillment = require('../src/models/SubscriptionFulfillment');
const Product = require('../src/models/Product');
const { pinBox, changeDefinition } = require('../src/services/boxDefinitionService');
const { transitionFulfillment } = require('../src/services/subscriptionService');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
async function fixture(isGift = false) {
  const { user } = await createUser();
  const brand = await createBrand();
  const product = await createProduct(brand, { price: 100000, stock: 10 });
  const box = await Box.create({ name: 'Original box', descriptions: 'Original', stock: 10,
    validFrom: new Date(Date.now() - 86400000), validTo: new Date(Date.now() + 86400000 * 400),
    value: 100000, isGift,
    products: [{ productId: product._id, name: product.name, price: product.price, quantity: 1 }] });
  return { user, product, box };
}
async function subscribe(box, user, { paid = false, gift = [] } = {}) {
  let sub;
  await mongoose.connection.transaction(async session => {
    const pin = await pinBox(box._id, session);
    [sub] = await Subscription.create([{
      userId: user._id, templateId: new mongoose.Types.ObjectId(), boxId: box._id,
      boxVersionId: pin.version._id, snapshotOrigin: 'pinned_at_purchase', planType: '1_month',
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
      totalDeliveries: 1, remainDeliveries: 1, status: paid ? 'active' : 'pending_payment',
      paymentStatus: paid ? 'paid' : 'pending', nextDeliveries: paid ? new Date() : null,
      shippingAddress: user.addresses[0].toObject(), price: 100000, oldPrice: 100000,
      discount: 0, discountPercent: 0, gift,
    }], { session });
  });
  return sub;
}
test('unused Box creates immutable before/after versions; update cannot set stock', async () => {
  const { box } = await fixture();
  const changed = await changeDefinition(box._id, { name: 'Updated box', stock: 999 });
  expect(changed.definitionVersion).toBe(2);
  expect(changed.stock).toBe(10);
  expect((await BoxVersion.findOne({ boxId: box._id, version: 1 })).definition.name).toBe('Original box');
  await expect(BoxVersion.updateOne({ boxId: box._id }, { $set: { 'definition.name': 'Tampered' } }))
    .rejects.toThrow('immutable');
});
test.each([false, true])('pending/paid subscription blocks edit and archive (paid=%s)', async paid => {
  const { box, user } = await fixture();
  await subscribe(box, user, { paid });
  await expect(changeDefinition(box._id, { name: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(changeDefinition(box._id, {}, { archive: true })).rejects.toMatchObject({ statusCode: 409 });
  expect((await Box.findById(box._id)).name).toBe('Original box');
});
test('a gift Box referenced by a paid subscription is protected', async () => {
  const { box, user } = await fixture();
  const { box: giftBox } = await fixture(true);
  await subscribe(box, user, { paid: true, gift: [{ boxId: giftBox._id, quantity: 1 }] });
  await expect(changeDefinition(giftBox._id, {}, { archive: true })).rejects.toMatchObject({ statusCode: 409 });
});
test('archived Box is hidden and cannot be pinned', async () => {
  const { box } = await fixture();
  await changeDefinition(box._id, {}, { archive: true });
  expect((await request(app).get(`/api/boxes/public/${box._id}`)).status).toBe(404);
  await expect(mongoose.connection.transaction(session => pinBox(box._id, session)))
    .rejects.toMatchObject({ statusCode: 404 });
});
test('subscription endpoint persists main and gift version IDs', async () => {
  const { box, user } = await fixture();
  const { box: giftBox } = await fixture(true);
  const template = await Template.create({ name: 'Versioned plan', boxId: box._id,
    planType: '1_month', basePrice: 100000, discountPrice: 100000, discountPercent: 0,
    gift: [{ boxId: giftBox._id, quantity: 1 }], isActive: true });
  // Call the real controller with validated input; route coverage exists in regression suite.
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }, next = jest.fn();
  await require('../src/controllers/userSubscriptionController').subscribeToTemplate({
    get: () => 'versioned-subscription-key', userId: String(user._id),
    validatedBody: { templateId: String(template._id), shippingAddress: user.addresses[0].toObject() },
  }, res, next);
  expect(next).not.toHaveBeenCalled();
  const sub = await Subscription.findOne({ userId: user._id });
  expect(sub.boxVersionId).toBeTruthy();
  expect(sub.gift[0].versionId).toBeTruthy();
});
test('dispatch uses pinned components even if live Box is changed through raw DB write', async () => {
  const { box, user, product } = await fixture();
  const sub = await subscribe(box, user, { paid: true });
  const fulfillment = await Fulfillment.create({ subscriptionId: sub._id, userId: user._id,
    sequence: 1, dueAt: new Date() });
  // Simulate legacy external writer. New application routes prohibit this mutation.
  await Box.collection.updateOne({ _id: box._id }, { $set: { 'products.0.quantity': 9 } });
  const result = await transitionFulfillment(fulfillment._id, user._id, false, 'TRACK');
  expect(result.products[0].quantity).toBe(1);
  expect((await Product.findById(product._id)).stock).toBe(9);
});
test('concurrent pin and edit cannot produce a subscription with a mutable definition', async () => {
  const { box, user } = await fixture();
  const [pinResult, editResult] = await Promise.allSettled([
    subscribe(box, user), changeDefinition(box._id, { name: 'New definition' }),
  ]);
  expect(pinResult.status).toBe('fulfilled');
  const sub = pinResult.value;
  const snapshot = await BoxVersion.findById(sub.boxVersionId);
  const live = await Box.findById(box._id);
  if (editResult.status === 'fulfilled') expect(snapshot.version).toBe(2);
  else expect(editResult.reason.statusCode).toBe(409);
  expect(snapshot.definition.name).toBe(live.name);
});
