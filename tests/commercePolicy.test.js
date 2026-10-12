const { normalizeLines, giftFor, lineId, bulkPercent, fees } = require('../src/services/commercePolicy');
const { syncCartSchema } = require('../src/middleware/validationSchemas');
const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const id = '000000000000000000000001';
test('same SKU + same gift merges; different message, wrap and discriminator remain separate', () => {
  const lines = normalizeLines([{ productId: id, quantity: 1 }, { productId: id, quantity: 2 },
    { productId: id, quantity: 1, gift: { wrap: 'classic', message: 'A' } },
    { productId: id, quantity: 1, gift: { wrap: 'classic', message: 'B' } }, { boxId: id, quantity: 1 }]);
  expect(lines).toHaveLength(4); expect(lines.find(i => i.productId && i.gift.wrap === 'none').quantity).toBe(3);
  expect(new Set(lines.map(i => i.lineId)).size).toBe(4);
});
test.each([{}, {productId:id,boxId:id}])('ambiguous line rejected %p', fields => {
  expect(() => normalizeLines([{ ...fields, quantity: 1 }])).toThrow();
});
test('quantity overflow rejects instead of silent clamp', () => {
  expect(() => normalizeLines([{ productId:id, quantity:999 },{ productId:id, quantity:1 }])).toThrow();
});
test('client fee/unknown wrap/message overflow rejected', () => {
  expect(() => giftFor({ wrap:'premium', fee:0 })).toThrow();
  expect(() => giftFor({ wrap:'evil' })).toThrow();
  expect(() => giftFor({ message:'a'.repeat(501) })).toThrow();
});
test('forged lineId rejected', () => expect(() => normalizeLines([{ productId:id, quantity:1, lineId:'f'.repeat(64) }])).toThrow());
test.each([[1,0],[2,0],[3,5],[4,5],[5,10],[999,10]])('bulk boundary %i => %i', (q,p) => expect(bulkPercent(q)).toBe(p));
test('Joi keeps gift and rejects price injection', () => {
  const valid = syncCartSchema.validate({items:[{productId:id,quantity:1,gift:{wrap:'premium',message:'Hi'}}]});
  expect(valid.error).toBeUndefined(); expect(valid.value.items[0].gift.message).toBe('Hi');
  expect(syncCartSchema.validate({items:[{productId:id,quantity:1,gift:{wrap:'premium',fee:0}}]}).error).toBeDefined();
});
test('Mongoose cart and order persist gift snapshots independently of catalog', () => {
  const cart=new Cart({items:[{productId:id,quantity:1,gift:{wrap:'premium',message:'Hi'}}],totalPrice:0});
  const normalized=normalizeLines(cart.items);
  const order=new Order({products:[{productId:id,name:'Gift',unitPrice:1,totalPrice:1,quantity:1,lineId:normalized[0].lineId,gift:normalized[0].gift,giftFee:fees.premium}]});
  cart.items[0].gift.message='Changed';
  expect(order.toObject().products[0].gift.message).toBe('Hi');
  expect(lineId(normalized[0])).toBe(normalized[0].lineId);
});
