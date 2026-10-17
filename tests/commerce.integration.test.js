const request=require('supertest');
const app=require('../src/app');
const {connect,clearDatabase,closeDatabase}=require('./helpers/db');
const {createUser,signToken,createBrand,createProduct,createCoupon}=require('./helpers/factories');
const Cart=require('../src/models/Cart'),Order=require('../src/models/Order');
beforeAll(connect);afterEach(clearDatabase);afterAll(closeDatabase);
const auth=user=>({Authorization:`Bearer ${signToken(user)}`});
test('gift survives sync -> quote -> split orders; coupon excludes gifts and shipping',async()=>{
  const {user}=await createUser();
  const first=await createProduct(await createBrand(),{price:100000,stock:20});
  const second=await createProduct(await createBrand(),{price:100000,stock:20});
  await createCoupon({code:'SAVE',discount:10});
  const items=[{productId:String(first._id),quantity:3,gift:{wrap:'classic',message:'For A'}},{productId:String(second._id),quantity:1,gift:{wrap:'premium',message:'For B'}}];
  const sync=await request(app).put('/api/carts/sync').set(auth(user)).send({items});expect(sync.status).toBe(200);
  expect((await Cart.findOne({userId:user._id})).items.map(i=>i.gift.message).sort()).toEqual(['For A','For B']);
  const quote=await request(app).post('/api/checkout/quote').set(auth(user)).send({items,couponCode:'SAVE'});
  expect(quote.status).toBe(200);expect(quote.body.data).toMatchObject({subtotal:385000,bulkDiscountAmount:15000,giftFee:80000,discountAmount:38500,shippingFee:0,shippingPayment:'customer_to_carrier',totalAmount:426500});
  const placed=await request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key','commerce-integration-key').send({addressId:String(user.addresses[0]._id),paymentMethod:'cod',couponCode:'SAVE',quoteFingerprint:quote.body.data.fingerprint});
  expect(placed.status).toBe(201);const orders=await Order.find({userId:user._id});expect(orders).toHaveLength(2);
  expect(orders.reduce((n,o)=>n+o.totalAmount,0)).toBe(426500);expect(orders.reduce((n,o)=>n+o.giftFee,0)).toBe(80000);
  expect(orders.flatMap(o=>o.products.map(p=>p.gift.message)).sort()).toEqual(['For A','For B']);
});
test('gift variants stay separate and legacy product-id mutation fails closed',async()=>{
  const {user}=await createUser(),p=await createProduct(await createBrand(),{stock:20});
  const items=[{productId:String(p._id),quantity:2,gift:{wrap:'classic',message:'A'}},{productId:String(p._id),quantity:3,gift:{wrap:'classic',message:'B'}}];
  const sync=await request(app).put('/api/carts/sync').set(auth(user)).send({items});expect(sync.status).toBe(200);expect(sync.body.data.items).toHaveLength(2);
  const old=await request(app).put(`/api/carts/update-cart/${p._id}`).set(auth(user)).send({quantity:1});expect(old.status).toBe(409);
  expect((await Cart.findOne({userId:user._id})).items.reduce((n,i)=>n+i.quantity,0)).toBe(5);
  const changed=[{...sync.body.data.items[0],quantity:1},{...sync.body.data.items[1]}].map(({productId,quantity,gift,lineId})=>({productId,quantity,gift,lineId}));
  expect((await request(app).put('/api/carts/sync').set(auth(user)).send({items:changed,version:sync.body.version})).status).toBe(200);
});
test('changed gift after quote rejects checkout and rolls back coupon claim',async()=>{
  const {user}=await createUser(),p=await createProduct(await createBrand());await createCoupon({code:'SAVE',usageLimit:1});
  const items=[{productId:String(p._id),quantity:1,gift:{wrap:'classic',message:'A'}}];
  const quote=await request(app).post('/api/checkout/quote').set(auth(user)).send({items,couponCode:'SAVE'});
  await request(app).put('/api/carts/sync').set(auth(user)).send({items:[{...items[0],gift:{wrap:'classic',message:'B'}}]});
  const placed=await request(app).post('/api/checkout/check-out').set(auth(user)).send({addressId:String(user.addresses[0]._id),paymentMethod:'cod',couponCode:'SAVE',quoteFingerprint:quote.body.data.fingerprint});
  expect(placed.status).toBe(409);expect(await Order.countDocuments()).toBe(0);expect((await require('../src/models/Coupon').findOne({code:'SAVE'})).usedCount).toBe(0);
});
