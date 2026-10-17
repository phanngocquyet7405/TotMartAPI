const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const Box = require('../src/models/Box');
const Template = require('../src/models/SubscriptionTemplate');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Order = require('../src/models/Order');
const config = require('../src/config/environment');
const app = express(); app.use(express.json());
app.use('/manager', require('../src/routes/managerRouter'));
app.get('/admin', require('../src/middleware/authMiddleware').adminMiddleware, (req, res) => res.sendStatus(200));
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const actor = '507f1f77bcf86cd799439011', target = '507f1f77bcf86cd799439012';
let role;
const auth = claims => `Bearer ${jwt.sign({ userId: actor, role: 'admin', tokenVersion: 0, ...claims }, config.jwt.secret)}`;
beforeEach(() => {
  role = 'merchant';
  jest.spyOn(User, 'findById').mockImplementation(async () => ({ _id: actor, role, tokenVersion: 0, isActive: true }));
});
afterEach(() => jest.restoreAllMocks());
test('uses database role: stale admin JWT cannot grant admin access', async () => {
  expect((await request(app).get('/admin').set('Authorization', auth())).status).toBe(403);
});
test.each(['user', 'admin'])('%s cannot use manager', async value => {
  role = value;
  expect((await request(app).get('/manager/products').set('Authorization', auth())).status).toBe(403);
});
test.each([['products', Product], ['combos', Box], ['subscriptions', Template]])('%s rejects foreign deletion and scopes ownership', async (resource, Model) => {
  let spy;
  if(resource==='products') {
    jest.spyOn(Brand,'find').mockReturnValue({select:()=>({session:async()=>[]})});
    spy=jest.spyOn(Product,'findOne').mockResolvedValue(null);
  } else if(resource==='combos') spy=jest.spyOn(Box,'findOne').mockResolvedValue(null);
  else spy=jest.spyOn(Template,'findOneAndUpdate').mockResolvedValue(null);
  const result=await request(app).delete(`/manager/${resource}/${target}`).set('Authorization',auth());
  expect(result.status).toBe(404);
  const filter=spy.mock.calls[0][0];expect(filter._id).toBe(target);
  if(resource==='products')expect(filter.$or).toEqual([{ownerId:actor},{ownerId:null}]);
  else expect(filter.ownerId).toBe(actor);
});
test('rejects malformed IDs before database access', async () => {
  const spy = jest.spyOn(Product, 'exists');
  expect((await request(app).delete('/manager/products/invalid').set('Authorization', auth())).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});
test('creation rejects attacker ownerId before product writes', async () => {
  jest.spyOn(Brand, 'exists').mockResolvedValue(true);
  jest.spyOn(Category, 'exists').mockResolvedValue(true);
  const create = jest.spyOn(Product, 'create').mockImplementation(async data => data);
  const result = await request(app).post('/manager/products').set('Authorization', auth()).send({ name: 'My food', description: 'Food', price: 100000, stock: 10, category: target, brand: target, ownerId: target });
  expect(result.status).toBe(400); expect(create).not.toHaveBeenCalled();
});
test('rejects foreign brand before product creation', async () => {
  jest.spyOn(Brand, 'exists').mockResolvedValue(null);
  const create = jest.spyOn(Product, 'create');
  const result = await request(app).post('/manager/products').set('Authorization', auth()).send({ name: 'My food', description: 'Food', price: 100000, stock: 10, category: target, brand: target });
  expect(result.status).toBe(403); expect(create).not.toHaveBeenCalled();
});
test('multipart combo decodes product list and rejects foreign products', async () => {
  jest.spyOn(Brand,'find').mockReturnValue({select:()=>({session:async()=>[{_id:target}]})});
  const find=jest.spyOn(Product,'find').mockReturnValue({session:async()=>[]});
  const result = await request(app).post('/manager/combos').set('Authorization', auth()).field('name', 'Combo test').field('descriptions', 'Combo').field('stock', '10').field('validTo', new Date(Date.now() + 86400000).toISOString()).field('products', JSON.stringify([{ productId: target, quantity: 1 }]));
  expect(result.status).toBe(403); expect(find.mock.calls[0][0]).toMatchObject({ _id: { $in: [target] }, archivedAt: null, $or:[{ownerId:actor},{ownerId:null}] });
});
test('orders filter by merchant and expose only allowed fields', async () => {
  const chain = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
  const find = jest.spyOn(Order, 'find').mockReturnValue(chain); jest.spyOn(Order, 'countDocuments').mockResolvedValue(0);
  const result = await request(app).get('/manager/orders?merchantId=' + target).set('Authorization', auth());
  expect(result.status).toBe(200); expect(find.mock.calls[0][0]).toMatchObject({merchantId:actor,$nor:[{paymentMethod:'online',paymentStatus:{$ne:'paid'}}]});
  expect(result.body.data).toEqual([]); expect(result.body.meta.hidesUnpaidOnline).toBe(true);
});
