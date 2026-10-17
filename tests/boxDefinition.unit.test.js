jest.mock('../src/models/Brand', () => ({ find: jest.fn() }));
jest.mock('../src/models/Box', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../src/models/BoxVersion', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/UserSubscription', () => ({ exists: jest.fn() }));
jest.mock('../src/models/Order', () => ({ exists: jest.fn() }));
jest.mock('../src/models/Product', () => ({ find: jest.fn() }));
const mongoose = require('mongoose');
const Box = require('../src/models/Box');
const Version = require('../src/models/BoxVersion');
const Subscription = require('../src/models/UserSubscription');
const Order = require('../src/models/Order');
const { pinBox, changeDefinition, loadPinnedVersion } = require('../src/services/boxDefinitionService');
const id = '507f1f77bcf86cd799439011';
const session = { inTransaction: () => true };
const query = result => ({ session: jest.fn().mockResolvedValue(result) });
let box;
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(mongoose.connection, 'transaction').mockImplementation(fn => fn(session));
  box = { _id: id, ownerId: id, definitionVersion: 1, stock: 10, name: 'Original', descriptions: 'Description',
    validFrom: new Date(0), validTo: new Date('2099-01-01'), isGift: false,
    discountPercent: 0, products: [{ productId: id, name: 'Product', price: 100, quantity: 1 }],
    images: [], save: jest.fn().mockResolvedValue(undefined) };
  require('../src/models/Product').find.mockReturnValue(query([{ _id: id, brand: id, ownerId: id }]));
  require('../src/models/Brand').find.mockReturnValue({ select: () => query([{ _id: id }]) });
  Box.findOneAndUpdate.mockResolvedValue(box);
  Version.findOne.mockReturnValue(query(null));
  Version.create.mockImplementation(async ([data]) => [{ _id: 'version', ...data }]);
  Subscription.exists.mockReturnValue(query(null));
  Order.exists.mockReturnValue(query(null));
});
afterEach(() => jest.restoreAllMocks());
test('pin requires active transaction', async () => {
  await expect(pinBox(id, null)).rejects.toThrow('active transaction');
  expect(Box.findOneAndUpdate).not.toHaveBeenCalled();
});
test('pin atomically touches shared Box and records definition', async () => {
  const result = await pinBox(id, session);
  expect(Box.findOneAndUpdate).toHaveBeenCalledWith({ _id: id, archivedAt: null },
    { $inc: { obligationRevision: 1 } }, { new: true, session });
  expect(result.version.definition.products[0].quantity).toBe(1);
  expect(result.version.definition.stock).toBeUndefined();
});
test('referenced subscription blocks edit before any snapshot write', async () => {
  Subscription.exists.mockReturnValue(query({ _id: 'sub' }));
  await expect(changeDefinition(id, { name: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
  expect(Version.create).not.toHaveBeenCalled();
  expect(box.save).not.toHaveBeenCalled();
});
test('referenced product order blocks archive', async () => {
  Order.exists.mockReturnValue(query({ _id: 'order' }));
  await expect(changeDefinition(id, {}, { archive: true })).rejects.toMatchObject({ statusCode: 409 });
  expect(box.save).not.toHaveBeenCalled();
});
test('editing creates before/after versions and retains stock', async () => {
  const result = await changeDefinition(id, { name: 'Changed', stock: 999 });
  expect(result.definitionVersion).toBe(2);
  expect(result.stock).toBe(10);
  expect(Version.create).toHaveBeenCalledTimes(2);
  expect(Version.create.mock.calls[0][0][0].definition.name).toBe('Original');
  expect(Version.create.mock.calls[1][0][0].definition.name).toBe('Changed');
});
test('missing pinned version fails closed for legacy subscription', async () => {
  await expect(loadPinnedVersion(id, null, session)).rejects.toMatchObject({ statusCode: 409 });
  expect(Version.findOne).not.toHaveBeenCalled();
});
test('client cannot write definitionVersion', async () => {
  await expect(changeDefinition(id, { definitionVersion: 99 })).rejects.toMatchObject({ statusCode: 400 });
  expect(box.save).not.toHaveBeenCalled();
});

test.each([undefined, '507f1f77bcf86cd799439012'])('admin cannot edit legacy/mixed ownership (%s)', async ownerId => {
  require('../src/models/Product').find.mockReturnValue(query([{ _id: id, brand: id, ownerId }]));
  if (!ownerId) box.ownerId = undefined;
  await expect(changeDefinition(id, { name: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
  expect(box.save).not.toHaveBeenCalled();
});

test('merchant cannot replace components with another merchant product inside transaction', async () => {
  require('../src/models/Product').find
    .mockReturnValueOnce(query([{ _id: id, brand: id, ownerId: id }]))
    .mockReturnValueOnce(query([{ _id: id, brand: id, ownerId: '507f1f77bcf86cd799439012' }]));
  await expect(changeDefinition(id, { products: [{ productId: id, quantity: 1 }] }, { ownerId: id }))
    .rejects.toMatchObject({ statusCode: 409 });
  expect(box.save).not.toHaveBeenCalled();
});
