const request = require('supertest');
const app = require('../src/app');
const {connect,clearDatabase,closeDatabase}=require('./helpers/db');
const {createUser,signToken,createBrand,createProduct,createCartWithItems}=require('./helpers/factories');
const Order=require('../src/models/Order'),Checkout=require('../src/models/Checkout');
beforeAll(connect);afterEach(clearDatabase);afterAll(closeDatabase);
async function fixture() {
  const {user}=await createUser(),brand=await createBrand(),product=await createProduct(brand,{price:100000,stock:10});
  await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
  return {user,product,payload:{addressId:String(user.addresses[0]._id),paymentMethod:'cod'}};
}
test.each(['cod','online'])('%s checkout charges merchandise without a fixed delivery fee',async paymentMethod=>{
  const {user,product,payload}=await fixture();
  const quote=await request(app).post('/api/checkout/quote').set('Authorization',`Bearer ${signToken(user)}`).send({items:[{productId:String(product._id),quantity:1}]});
  expect(quote.body.data).toMatchObject({shippingFee:0,shippingMode:'separate',subtotal:100000,totalAmount:100000});
  const res=await request(app).post('/api/checkout/check-out').set('Authorization',`Bearer ${signToken(user)}`).send({...payload,paymentMethod,quoteFingerprint:quote.body.data.fingerprint});
  expect(res.status).toBe(201);expect(res.body.data.totalAmount).toBe(100000);
  const order=await Order.findOne();expect(order.shippingFee).toBe(0);expect(order.shippingMode).toBe('separate');expect(order.totalAmount).toBe(100000);
});
test('retry preserves previously agreed totals instead of repricing a historical order',async()=>{
  const {user,payload}=await fixture(),key='historical-delivery-key-0001';
  const send=()=>request(app).post('/api/checkout/check-out').set('Authorization',`Bearer ${signToken(user)}`).set('Idempotency-Key',key).send(payload);
  const first=await send();expect(first.status).toBe(201);
  await Order.updateMany({paymentCode:first.body.data.orderCode},{$set:{shippingFee:30000,shippingMode:'legacy_fixed',totalAmount:130000}});
  await Checkout.updateOne({paymentCode:first.body.data.orderCode},{$set:{totalAmount:130000,'result.totalAmount':130000}});
  expect((await send()).body.data.totalAmount).toBe(130000);expect(await Order.countDocuments()).toBe(1);
  expect((await Order.findOne()).shippingFee).toBe(30000);
});

test('COD is not expired by bank-transfer timeout; delivery records only collected merchandise',async()=>{
  const {user,payload}=await fixture(),{user:admin}=await createUser({role:'admin'});
  const auth=req=>req.set('Authorization',`Bearer ${signToken(admin)}`);
  const placed=await request(app).post('/api/checkout/check-out').set('Authorization',`Bearer ${signToken(user)}`).send(payload);
  const order=await Order.findOne();
  function awaitablePost(path){return request(app).post('/api/checkout'+path);}
  const confirmed=await auth(awaitablePost(`/confirm-cod/${order._id}`));expect(confirmed.status).toBe(200);
  await Checkout.updateOne({paymentCode:placed.body.data.orderCode},{$set:{expiresAt:new Date(0)}});
  const status=()=>request(app).get('/api/checkout/order-status/'+placed.body.data.orderCode).set('Authorization',`Bearer ${signToken(user)}`);
  expect((await status()).body.data).toMatchObject({paymentStatus:'pending',remainingAmount:100000,payable:false});
  expect((await auth(awaitablePost(`/mark-cod-delivered/${order._id}`))).status).toBe(200);
  expect((await status()).body.data).toMatchObject({paymentStatus:'paid',receivedAmount:100000,remainingAmount:0});
  expect((await Checkout.findOne()).state).toBe('paid');
});
