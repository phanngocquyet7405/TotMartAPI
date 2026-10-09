const request = require('supertest'), app = require('../src/app');
const {connect,clearDatabase,closeDatabase} = require('./helpers/db');
const {createUser,signToken,createBrand,createProduct,createCartWithItems,createCoupon} = require('./helpers/factories');
const Order=require('../src/models/Order'), Checkout=require('../src/models/Checkout'), Product=require('../src/models/Product'), Coupon=require('../src/models/Coupon'), Box=require('../src/models/Box');
const Template=require('../src/models/SubscriptionTemplate'), Subscription=require('../src/models/UserSubscription'), Fulfillment=require('../src/models/SubscriptionFulfillment'), Event=require('../src/models/PaymentEvent');
const {createDueFulfillments,addMonths}=require('../src/services/subscriptionService');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
const auth = user => ({Authorization:`Bearer ${signToken(user)}`});
async function fixture() { const {user}=await createUser(), {user:admin}=await createUser({role:'admin'}), brand=await createBrand(), product=await createProduct(brand,{price:100001}); return {user,admin,product}; }
const body = user => ({addressId:String(user.addresses[0]._id),paymentMethod:'online'});
function pay(code,amount,ref='NEW-REF') { return request(app).post('/api/checkout/sepay-webhook').set('Authorization',`Apikey ${process.env.SEPAY_API_KEY}`).send({id:1,gateway:'TestBank',transactionDate:new Date().toISOString(),accountNumber:process.env.SEPAY_BANK_ACCOUNT,code,content:code,transferType:'in',transferAmount:amount,referenceCode:ref}); }
async function boxFor(product,parts) {return Box.create({name:'Test box',stock:10,descriptions:'Box',validFrom:new Date(Date.now()-86400000),validTo:new Date(Date.now()+86400000*400),value:200000,products:parts||[{productId:product._id,quantity:1}]});}
test('concurrent checkout retries cannot create two orders',async()=>{
  const {user,product}=await fixture();await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
  const send=()=>request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key','concurrent-checkout-key-123').send(body(user));
  const responses=await Promise.all([send(),send()]);expect(responses.map(r=>r.status)).toEqual([201,201]);expect(responses[0].body).toEqual(responses[1].body);expect(await Checkout.countDocuments()).toBe(1);expect(await Order.countDocuments()).toBe(1);
});
test('two customers competing for the final coupon cannot both claim it',async()=>{
  const {user,product}=await fixture(),{user:second}=await createUser(),coupon=await createCoupon({usageLimit:1});
  for(const customer of [user,second])await createCartWithItems(customer._id,[{productId:product._id,quantity:1}]);
  const responses=await Promise.all([user,second].map(customer=>request(app).post('/api/checkout/check-out').set(auth(customer)).send({...body(customer),couponCode:coupon.code})));
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);expect(await Order.countDocuments()).toBe(1);
});
test('subscription rejects a stale displayed total before creating payment records',async()=>{
  const {user,product}=await fixture(),box=await boxFor(product),template=await Template.create({name:'Plan',boxId:box._id,planType:'3_month',basePrice:600000,discountPercent:0,discountPrice:600000});
  const result=await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(user)).send({templateId:String(template._id),expectedTotalAmount:200000,shippingAddress:{address:'Street',district:'District',city:'City',country:'VN',phone:'0900000000'}});
  expect(result.status).toBe(409);expect(await Subscription.countDocuments()).toBe(0);expect(await Checkout.countDocuments()).toBe(0);
});
test('retry creates one checkout, consumes coupon once, rejects key reuse with changed body',async()=>{
  const {user,product}=await fixture(), coupon=await createCoupon({discountType:'fixed',discount:1});
  await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
  const payload={...body(user),couponCode:coupon.code}, key='checkout-retry-key-12345';
  const first=await request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key',key).send(payload);
  const second=await request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key',key).send(payload);
  expect(first.status).toBe(201); expect(second.body).toEqual(first.body); expect(await Checkout.countDocuments()).toBe(1); expect(await Order.countDocuments()).toBe(1); expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
  expect((await request(app).post('/api/checkout/check-out').set(auth(user)).set('Idempotency-Key',key).send({...payload,note:'changed'})).status).toBe(409);
});
test('box checkout uses box price, reserves components, and refunds stock on cancellation',async()=>{
  const {user,product}=await fixture(), box=await boxFor(product);
  const synced=await request(app).put('/api/carts/sync').set(auth(user)).send({items:[{boxId:String(box._id),quantity:2}],version:0}); expect(synced.status).toBe(200);
  const quote=await request(app).post('/api/checkout/quote').set(auth(user)).send({items:[{boxId:String(box._id),quantity:2}]}); expect(quote.body.data.totalAmount).toBe(430000);
  const placed=await request(app).post('/api/checkout/check-out').set(auth(user)).send({...body(user),quoteFingerprint:quote.body.data.fingerprint}); expect(placed.status).toBe(201);
  expect((await pay(placed.body.data.orderCode,430000)).status).toBe(200); expect((await Product.findById(product._id)).stock).toBe(8); expect((await Box.findById(box._id)).stock).toBe(8);
  const order=await Order.findOne(); expect((await request(app).post(`/api/checkout/cancel/${order._id}`).set(auth(user)).send({reason:'Test cancellation'})).status).toBe(200);
  expect((await Product.findById(product._id)).stock).toBe(10); expect((await Box.findById(box._id)).stock).toBe(10);
});
test('cancelled checkout has no QR; a late transfer remains visible for reconciliation',async()=>{
  const {user,product}=await fixture(); await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
  const placed=await request(app).post('/api/checkout/check-out').set(auth(user)).send(body(user)), order=await Order.findOne();
  await request(app).post(`/api/checkout/cancel/${order._id}`).set(auth(user)).send({});
  const status=await request(app).get(`/api/checkout/order-status/${placed.body.data.orderCode}`).set(auth(user)); expect(status.body.data.payable).toBe(false); expect(status.body.data.qrUrl).toBeUndefined();
  expect((await pay(placed.body.data.orderCode,placed.body.data.totalAmount)).status).toBe(409); expect((await Event.findOne()).state).toBe('not_payable');
});
test('a box split across merchants holds the entire group when one component is short',async()=>{
  const {user,admin,product}=await fixture(), second=await createProduct(await createBrand()), box=await boxFor(product,[{productId:product._id,quantity:1},{productId:second._id,quantity:1}]);
  await request(app).put('/api/carts/sync').set(auth(user)).send({items:[{boxId:String(box._id),quantity:1}],version:0});
  const placed=await request(app).post('/api/checkout/check-out').set(auth(user)).send(body(user)); await Product.findByIdAndUpdate(second._id,{stock:0,instock:false});
  expect((await pay(placed.body.data.orderCode,placed.body.data.totalAmount)).status).toBe(200);
  const orders=await Order.find(); expect(orders).toHaveLength(2); expect(orders.every(o=>o.status==='on_hold'&&!o.stockDeducted&&o.paymentStatus==='paid')).toBe(true); expect((await Product.findById(product._id)).stock).toBe(10); expect((await Box.findById(box._id)).stock).toBe(10);
  expect((await request(app).post(`/api/checkout/resolve-inventory/${orders[0]._id}`).set(auth(admin))).status).toBe(409);
  await Product.findByIdAndUpdate(second._id,{stock:3,instock:true});
  expect((await request(app).post(`/api/checkout/resolve-inventory/${orders[0]._id}`).set(auth(admin))).status).toBe(200); expect((await Order.find()).every(o=>o.status==='processing'&&o.stockDeducted)).toBe(true);
});
test('prepaid subscription only activates after full payment and decrements a delivery on confirmation',async()=>{
  const {user,admin,product}=await fixture(), box=await boxFor(product);
  // A legacy template's monthly stored price must not undercharge a full plan.
  const template=await Template.create({name:'Three months',boxId:box._id,planType:'3_month',basePrice:200000,discountPercent:10,discountPrice:180000,gift:[]});
  const start=await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(user)).set('Idempotency-Key','subscription-retry-key-123').send({templateId:String(template._id),shippingAddress:{address:'Street',district:'District',city:'City',country:'VN',phone:'0900000000'}});
  expect(start.status).toBe(201); expect(start.body.data.totalAmount).toBe(540000); expect(start.body.data.status).toBe('pending_payment');
  await createDueFulfillments(new Date(Date.now()+86400000*100)); expect(await Fulfillment.countDocuments()).toBe(0);
  expect((await pay(start.body.data.orderCode,540000)).status).toBe(200); const sub=await Subscription.findById(start.body.data._id); expect(sub.status).toBe('active'); expect(sub.remainDeliveries).toBe(3);
  await createDueFulfillments(addMonths(sub.currentPeriodStart,1)); await createDueFulfillments(addMonths(sub.currentPeriodStart,1)); expect(await Fulfillment.countDocuments()).toBe(1);
  const job=await Fulfillment.findOne(); expect((await Subscription.findById(sub._id)).completeDeliveries).toBe(0);
  expect((await request(app).post(`/api/subcribe-plans/fulfillments/${job._id}/dispatch`).set(auth(admin)).send({trackingReference:'TRACK-123'})).status).toBe(200);
  expect((await Subscription.findById(sub._id)).remainDeliveries).toBe(3);
  expect((await request(app).post(`/api/subcribe-plans/fulfillments/${job._id}/deliver`).set(auth(admin))).status).toBe(200);
  expect((await request(app).post(`/api/subcribe-plans/fulfillments/${job._id}/deliver`).set(auth(admin))).status).toBe(200);
  expect((await Subscription.findById(sub._id)).remainDeliveries).toBe(2); expect((await Product.findById(product._id)).stock).toBe(9);
});
