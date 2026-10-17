const { allowedTransitions, transition } = require('../src/services/merchantOrderPolicy');
const schemas = require('../src/middleware/managerSchemas');
const base = overrides => ({ stockDeducted: true, paymentMethod: 'cod', paymentStatus: 'pending', status: 'pending', ...overrides });
test('merchant can operate fulfillment, not bypass unpaid online or missing stock', () => {
  expect(allowedTransitions(base())).toEqual(['processing']);
  expect(allowedTransitions(base({ paymentMethod: 'online' }))).toEqual([]);
  expect(allowedTransitions(base({ stockDeducted: false }))).toEqual([]);
  expect(allowedTransitions(base({ status: 'processing' }))).toEqual(['shipped']);
  expect(allowedTransitions(base({ status: 'shipped' }))).toEqual(['delivered']);
  for (const status of ['cancelled', 'delivered', 'returned', 'on_hold']) expect(allowedTransitions(base({ status }))).toEqual([]);
});
test('merchant delivery report never marks COD paid or changes finance fields', () => {
  const order = base({ status: 'shipped', totalAmount: 123, refundStatus: 'not_applicable' });
  transition(order, { status: 'delivered' }, 'merchant');
  expect(order).toMatchObject({ status: 'delivered', paymentStatus: 'pending', codCollectionStatus: 'pending_review', totalAmount: 123, refundStatus: 'not_applicable' });
  expect(order.paidAt).toBeUndefined();
  expect(transition(order, { status: 'delivered' }, 'merchant')).toBe(false);
});
test('stale state, skipped transitions, cancellation and refund holds are rejected', () => {
  expect(() => transition(base(), { status: 'shipped' }, 'm')).toThrow();
  expect(() => transition(base(), { status: 'cancelled' }, 'm')).toThrow();
  expect(() => transition(base(), { status: 'processing', expectedStatus: 'shipped' }, 'm')).toThrow();
  expect(allowedTransitions(base({ status: 'processing', refundStatus: 'pending' }))).toEqual([]);
});
test('gift schema rejects duplicate tiers, invalid amenities, foreign money/ownership fields', () => {
  const input = { name: 'Test gift', comboId: 'a'.repeat(24), stock: 5, validTo: '2099-01-01' };
  expect(schemas.createGift.validate({ ...input, giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }, { minQuantity: 3, percent: 20 }] } }).error).toBeDefined();
  expect(schemas.createGift.validate({ ...input, giftPolicy: { amenities: [{ name: 'Gift card', fee: -1 }] } }).error).toBeDefined();
  expect(schemas.createGift.validate({ ...input, ownerId: 'b'.repeat(24) }).error).toBeDefined();
  expect(schemas.orderStatus.validate({ status: 'delivered', paymentStatus: 'paid' }).error).toBeDefined();
});
test('source identity and stock cannot be overwritten through metadata edit schemas', () => {
  expect(schemas.updateGift.validate({ comboId: 'a'.repeat(24) }).error).toBeDefined();
  expect(schemas.updateCombo.validate({ stock: 100 }).error).toBeDefined();
  expect(schemas.updateProduct.validate({ stock: 100 }).error).toBeDefined();
  expect(schemas.createSubscription.validate({ name: 'Sub', boxId: 'a'.repeat(24), planType: '3_month', discountPercent: 100 }).error).toBeDefined();
});
test('ownership migration never chooses a seller for mixed or unknown constituents', () => {
  const { unanimousOwner } = require('../scripts/migrate-merchant-ownership');
  const map = new Map([['a', 'seller-a'], ['b', 'seller-b'], ['c', 'seller-a']]);
  expect(unanimousOwner([{ productId: 'a' }, { productId: 'c' }], map)).toBe('seller-a');
  expect(unanimousOwner([{ productId: 'a' }, { productId: 'b' }], map)).toBeNull();
  expect(unanimousOwner([{ productId: 'a' }, { productId: 'missing' }], map)).toBeNull();
  expect(unanimousOwner([], map)).toBeNull();
});
