const request=require('supertest');
const app=require('../src/app');const db=require('./helpers/db');
const {createUser,createBrand,createProduct,createCartWithItems,signToken}=require('./helpers/factories');
const Order=require('../src/models/Order'),Checkout=require('../src/models/Checkout'),Product=require('../src/models/Product');
beforeAll(db.connect);afterEach(db.clearDatabase);afterAll(db.closeDatabase);
const auth=user=>({Authorization:`Bearer ${signToken(user)}`});
test('concurrent customer receipt is scoped, auditable, idempotent and does not confirm money',async()=>{
 const {user}=await createUser(),{user:other}=await createUser();const brand=await createBrand(),product=await createProduct(brand);
 const order=await Order.create({userId:user._id,merchantId:brand.ownerId,orderId:'RECEIPT',paymentCode:'RECEIPT',paymentMethod:'online',paymentStatus:'paid',status:'shipped',stockDeducted:true,totalAmount:100000,customerEmail:user.email,products:[{productId:product._id,name:product.name,quantity:1,unitPrice:100000,totalPrice:100000}]});
 const url=`/api/orders/${order._id}/confirm-receipt`;
 expect((await request(app).post(url).set(auth(other))).status).toBe(404);
 const results=await Promise.all([request(app).post(url).set(auth(user)),request(app).post(url).set(auth(user))]);
 for(const res of results){expect(res.status).toBe(200);expect(res.body.data.customerEmail).toBeUndefined();}
 const saved=await Order.findById(order._id);expect(saved.statusHistory.filter(h=>h.status==='delivered')).toHaveLength(1);expect(saved.paymentStatus).toBe('paid');expect(saved.__v).toBe(order.__v+1);
 await Order.updateOne({_id:order._id},{$set:{status:'shipped',paymentMethod:'cod',paymentStatus:'pending'}});
 expect((await request(app).post(url).set(auth(user))).status).toBe(409);
});
test('merchant options and creation are admin-only; new brand can be assigned to an active merchant',async()=>{
 const {user:admin}=await createUser({role:'admin'}),{user:merchant}=await createUser({role:'merchant'}),{user:customer}=await createUser();
 for(const user of [merchant,customer])expect((await request(app).get('/api/brands/merchant-options').set(auth(user))).status).toBe(403);
 const options=await request(app).get('/api/brands/merchant-options').set(auth(admin));expect(options.status).toBe(200);expect(options.body.data.map(u=>u._id)).toContain(String(merchant._id));expect(options.body.data[0].email).toBeUndefined();
 const created=await request(app).post('/api/brands/create-brand').set(auth(admin)).send({name:'Assigned brand',ownerId:String(merchant._id)});
 expect(created.status).toBe(201);expect(created.body.data.ownerId).toBe(String(merchant._id));
 expect((await request(app).post('/api/brands/create-brand').set(auth(admin)).send({name:'Invalid owner brand',ownerId:String(customer._id)})).status).toBe(400);
});
test('legacy cross-owner rebranding and inconsistent direct ownership cannot enter checkout',async()=>{
 const {user:admin}=await createUser({role:'admin'}),{user:customer}=await createUser();const a=await createBrand(),b=await createBrand(),p=await createProduct(a);
 expect((await request(app).put(`/api/products/update-product/${p._id}`).set(auth(admin)).send({brand:String(b._id)})).status).toBe(409);
 await Product.collection.updateOne({_id:p._id},{$set:{ownerId:b.ownerId}});
 expect((await request(app).post('/api/checkout/quote').set(auth(customer)).send({items:[{productId:String(p._id),quantity:1}]})).status).toBe(409);
});
test('split COD ledger settles only collected merchandise and ignores bank transfer expiry',async()=>{
 const {user:admin}=await createUser({role:'admin'}),{user:customer}=await createUser();const a=await createBrand(),b=await createBrand(),p=await createProduct(a),q=await createProduct(b);
 await createCartWithItems(customer._id,[{productId:p._id,quantity:1},{productId:q._id,quantity:1}]);
 const placed=await request(app).post('/api/checkout/check-out').set(auth(customer)).send({addressId:String(customer.addresses[0]._id),paymentMethod:'cod'});expect(placed.status).toBe(201);
 const code=placed.body.data.orderCode,orders=await Order.find({paymentCode:code});expect(orders).toHaveLength(2);
 for(let i=0;i<orders.length;i++){
  expect((await request(app).post(`/api/checkout/confirm-cod/${orders[i]._id}`).set(auth(admin))).status).toBe(200);
  expect((await request(app).post(`/api/checkout/mark-cod-delivered/${orders[i]._id}`).set(auth(admin))).status).toBe(200);
  const checkout=await Checkout.findOne({paymentCode:code});expect(checkout.receivedAmount).toBe((i+1)*100000);expect(checkout.state).toBe(i?'paid':'pending');
  await Checkout.updateOne({_id:checkout._id},{$set:{expiresAt:new Date(0)}});
  const status=await request(app).get(`/api/checkout/order-status/${code}`).set(auth(customer));expect(status.body.data.paymentStatus).toBe(i?'paid':'pending');expect(status.body.data.remainingAmount).toBe(i?0:100000);
 }
 expect((await request(app).post(`/api/checkout/mark-cod-delivered/${orders[0]._id}`).set(auth(admin))).status).toBe(200);
 expect((await Checkout.findOne({paymentCode:code})).receivedAmount).toBe(200000);
});
