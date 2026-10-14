jest.mock('../src/models/Product', () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock('../src/models/Box', () => ({ find: jest.fn() }));
jest.mock('../src/models/Coupon', () => ({ findOne: jest.fn() }));
const Product=require('../src/models/Product'), Box=require('../src/models/Box'), Coupon=require('../src/models/Coupon');
const { buildQuote }=require('../src/services/pricingService');
const P='000000000000000000000001', B='000000000000000000000002';
const product=(overrides={}) => ({_id:P,name:'Product',price:100000,salePercent:0,stock:100,brand:{_id:'brand',ownerId:'merchant'},...overrides});
function query(data) { return { populate:jest.fn().mockReturnThis(),session:jest.fn().mockResolvedValue(data) }; }
beforeEach(()=>{jest.clearAllMocks();Product.find.mockReturnValue(query([product()]));Box.find.mockReturnValue(query([]));Coupon.findOne.mockReturnValue(query(null));});
test('bulk before coupon; no discount on wrapping/shipping',async()=>{
  Coupon.findOne.mockReturnValue(query({code:'SAVE',isActive:true,startDate:new Date(0),expiresAt:new Date(Date.now()+60000),minOrderValue:0,usageLimit:null,discountType:'percentage',discount:10}));
  const q=await buildQuote([{productId:P,quantity:3,gift:{wrap:'classic',message:'Hi'}}],'SAVE');
  expect(q).toMatchObject({baseSubtotal:300000,bulkDiscountAmount:15000,subtotal:285000,discountAmount:28500,giftFee:45000,shippingFee:0,shippingMode:"separate",totalAmount:301500});
});
test('five across gift variants qualifies same SKU, fees per unit',async()=>{
  const q=await buildQuote([{productId:P,quantity:2,gift:{wrap:'eco'}},{productId:P,quantity:3,gift:{wrap:'premium'}}]);
  expect(q.bulkDiscountAmount).toBe(50000);expect(q.giftFee).toBe(135000);expect(q.totalAmount).toBe(585000);
});
test('box demand aggregates across gift variants; batch read no inventory reread',async()=>{
  Box.find.mockReturnValue(query([{_id:B,name:'Box',value:100000,stock:4,products:[{productId:P,quantity:1}],validFrom:new Date(0),validTo:new Date(Date.now()+60000)}]));
  const q=await buildQuote([{productId:P,quantity:3},{boxId:B,quantity:1},{boxId:B,quantity:2,gift:{wrap:'premium'}}]);
  expect(Product.find).toHaveBeenCalledTimes(1);expect(Product.findById).not.toHaveBeenCalled();expect(Box.find).toHaveBeenCalledTimes(1);
  expect(q.boxes[0].quantity).toBe(3);expect(q.bulkDiscountAmount).toBe(15000);
  expect(q.lines.filter(l=>l.itemType==='box').every(l=>l.bulkPercent===0)).toBe(true);
  expect(q.products.reduce((n,p)=>n+p.giftFee,0)).toBe(q.giftFee);
});
test('direct plus box demand checked together using batch snapshot',async()=>{
  Product.find.mockReturnValue(query([product({stock:3})]));
  Box.find.mockReturnValue(query([{_id:B,name:'Box',value:100000,stock:10,products:[{productId:P,quantity:2}],validFrom:new Date(0),validTo:new Date(Date.now()+60000)}]));
  await expect(buildQuote([{productId:P,quantity:2},{boxId:B,quantity:1}])).rejects.toThrow('không đủ hàng');
});
test('same cart order-independent fingerprint; changed gift invalidates quote',async()=>{
  const a={productId:P,quantity:1,gift:{wrap:'classic',message:'A'}},b={productId:P,quantity:1,gift:{wrap:'premium',message:'B'}};
  const first=await buildQuote([a,b]), second=await buildQuote([b,a]),changed=await buildQuote([{...a,gift:{wrap:'classic',message:'C'}},b]);
  expect(first.fingerprint).toBe(second.fingerprint);expect(changed.fingerprint).not.toBe(first.fingerprint);
});
test('fractional/negative legacy prices fail rather than sell incorrectly',async()=>{
  Product.find.mockReturnValue(query([product({price:100000.5})]));
  await expect(buildQuote([{productId:P,quantity:1}])).rejects.toThrow('VND');
});
test('gift combo aggregates tiers across variants and charges bundled amenities', async () => {
  Box.find.mockReturnValue(query([{ _id: B, name: 'Gift', value: 200000, isGift: true, sourceComboId: 'combo', stock: 10, products: [{ productId: P, quantity: 2 }], validFrom: new Date(0), validTo: new Date(Date.now() + 60000), giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Card', fee: 5000 }] } }]));
  const q = await buildQuote([{ boxId: B, quantity: 1 }, { boxId: B, quantity: 2, gift: { message: 'A' } }]);
  expect(q).toMatchObject({ baseSubtotal: 600000, subtotal: 540000, bulkDiscountAmount: 60000, giftFee: 15000, totalAmount: 555000 });
  expect(q.products.reduce((n, p) => n + p.bulkDiscountAmount, 0)).toBe(q.bulkDiscountAmount);
  expect(q.products.reduce((n, p) => n + p.giftFee, 0)).toBe(q.giftFee);
});
test('retail subscription delivery box cannot be purchased directly', async () => {
  Box.find.mockReturnValue(query([{ _id: B, name: 'Internal', subscriptionOnly: true, value: 100000, stock: 10, products: [{ productId: P, quantity: 1 }], validFrom: new Date(0), validTo: new Date(Date.now() + 60000) }]));
  await expect(buildQuote([{ boxId: B, quantity: 1 }])).rejects.toThrow('không còn bán');
});
test('merchant product owner controls order allocation ahead of legacy brand owner', async () => {
  Product.find.mockReturnValue(query([product({ ownerId: 'actual-merchant' })]));
  const q = await buildQuote([{ productId: P, quantity: 1 }]);
  expect(q.products[0].merchantId).toBe('actual-merchant');
});
