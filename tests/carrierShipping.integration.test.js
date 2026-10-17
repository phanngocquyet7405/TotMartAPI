const request=require('supertest');
const app=require('../src/app');
const db=require('./helpers/db');
const {createUser,createBrand,createProduct,createCartWithItems,signToken}=require('./helpers/factories');
const Order=require('../src/models/Order');
const {deliverySnapshot}=require('../src/services/deliverySnapshot');
beforeAll(db.connect);afterEach(db.clearDatabase);afterAll(db.closeDatabase);
test('COD and QR collect only merchandise; shipping choice is snapshotted and retry cannot reprice',async()=>{
 for(const paymentMethod of ['cod','online']) {
  const {user}=await createUser();const brand=await createBrand();const product=await createProduct(brand,{price:100000,stock:10});
  await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
  const auth={Authorization:`Bearer ${signToken(user)}`};
  const quote=await request(app).post('/api/checkout/quote').set(auth).send({items:[{productId:String(product._id),quantity:1}]});
  expect(quote.body.data).toMatchObject({shippingFee:0,shippingPayment:'customer_to_carrier',shippingFeeIncluded:false,totalAmount:100000,policyVersion:'commerce-v2-delivery-separate'});
  const payload={addressId:String(user.addresses[0]._id),paymentMethod,quoteFingerprint:quote.body.data.fingerprint};
  const key=`carrier-policy-${paymentMethod}`;
  const placed=await request(app).post('/api/checkout/check-out').set(auth).set('Idempotency-Key',key).send(payload);
  expect(placed.status).toBe(201);expect(placed.body.data.totalAmount).toBe(100000);
  const order=await Order.findById(placed.body.data.orderId);expect(order.shippingPayment).toBe('customer_to_carrier');expect(order.shippingFee).toBe(0);
  // A historical amount remains immutable even after new catalog prices arrive.
  await product.updateOne({price:200000});
  const retry=await request(app).post('/api/checkout/check-out').set(auth).set('Idempotency-Key',key).send(payload);
  expect(retry.status).toBe(201);expect(retry.body.data).toEqual(placed.body.data);
  expect(await Order.countDocuments({userId:user._id})).toBe(1);
 }
});
test('delivery snapshot uses explicit recipient and retains legacy account-name fallback',()=>{
 const address={fullName:'Recipient Name',phone:'0901234567',address:'12 Street A',district:'District',city:'City',country:'Vietnam'};
 expect(deliverySnapshot({name:'Account Name'},address).fullName).toBe('Recipient Name');
 delete address.fullName;expect(deliverySnapshot({name:'Account Name'},address).fullName).toBe('Account Name');
});
test('saved checkout address keeps recipient and cannot be added to another customer account',async()=>{
 const {user}=await createUser();const {user:other}=await createUser();
 const auth={Authorization:`Bearer ${signToken(user)}`};
 const payload={fullName:'Separate Recipient',country:'VN',city:'Ho Chi Minh',district:'District 1',address:'12 Address Street',phone:'0901234567'};
 const denied=await request(app).post(`/api/users/update-address/${other._id}`).set(auth).send(payload);
 expect(denied.status).toBe(403);
 const added=await request(app).post(`/api/users/update-address/${user._id}`).set(auth).send(payload);
 expect(added.status).toBe(200);const address=added.body.data.addresses.at(-1);expect(address.fullName).toBe(payload.fullName);
 const brand=await createBrand();const product=await createProduct(brand,{price:100000});
 await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
 const placed=await request(app).post('/api/checkout/check-out').set(auth).set('Idempotency-Key','saved-recipient-checkout').send({addressId:address._id,paymentMethod:'cod'});
 expect(placed.status).toBe(201);expect((await Order.findById(placed.body.data.orderId)).shippingAddress.fullName).toBe(payload.fullName);
});
test('admin and merchant subscription contracts reject a 100 percent prepaid discount',()=>{
 const admin=require('../src/middleware/validationSchemas');const manager=require('../src/middleware/managerSchemas');
 const payload={name:'Test template',boxId:'000000000000000000000001',planType:'3_month',discountPercent:100};
 expect(admin.createSubscriptionTemplateSchema.validate(payload).error).toBeDefined();
 expect(admin.updateSubscriptionTemplateSchema.validate({discountPercent:100}).error).toBeDefined();
 expect(manager.createSubscription.validate(payload).error).toBeDefined();
 expect(admin.createSubscriptionTemplateSchema.validate({...payload,discountPercent:99}).error).toBeUndefined();
});
