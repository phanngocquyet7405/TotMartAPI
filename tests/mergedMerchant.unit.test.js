jest.mock('../src/services/boxDefinitionService', () => ({ changeDefinition: jest.fn(), guardBox: jest.fn() }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User'), Brand = require('../src/models/Brand'), Product = require('../src/models/Product'), Box = require('../src/models/Box'), Order = require('../src/models/Order');
const scope = require('../src/services/merchantScope');
const definitions = require('../src/services/boxDefinitionService');
const app = express(); app.use(express.json());
app.use('/manager', require('../src/routes/managerRouter'));
app.use('/orders', require('../src/routes/customerOrderRouter'));
app.use('/brands', require('../src/routes/brandRouter'));
app.use((e, req, res, next) => res.status(e.statusCode || 500).json({ message: e.message }));
const actor = '507f1f77bcf86cd799439011', target = '507f1f77bcf86cd799439012';
let role;
const authorization = () => `Bearer ${jwt.sign({ userId: actor, tokenVersion: 0 }, require('../src/config/environment').jwt.secret)}`;
beforeEach(() => { role = 'merchant'; jest.spyOn(User, 'findById').mockImplementation(async () => ({ _id: actor, role, tokenVersion: 0, isActive: true })); });
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });
test('multipart combo update parses products and calls version service only after ownership validation', async () => {
  jest.spyOn(Box,'findOne').mockResolvedValue({_id:target,isGift:false,internalSubscription:false});
  jest.spyOn(Brand,'find').mockReturnValue({select:()=>({session:async()=>[{_id:target}]})});
  jest.spyOn(Product,'find').mockReturnValue({session:async()=>[{_id:target,name:'Fixture',price:100000}]});
  definitions.changeDefinition.mockResolvedValue({ _id: target, name: 'Changed' });
  const res = await request(app).put('/manager/combos/' + target).set('Authorization', authorization()).field('name', 'Changed').field('products', JSON.stringify([{ productId: target, quantity: 2 }]));
  expect(res.status).toBe(200); expect(definitions.changeDefinition.mock.calls[0][1].products).toEqual([{ productId: target, quantity: 2 }]);
});
test('owner filter refuses ordinary users and never accepts query ownerId', () => {
  expect(scope.ownerFilter({ user: { role: 'merchant' }, userId: actor, query: { ownerId: target } })).toEqual({ ownerId: actor });
  expect(() => scope.ownerFilter({ user: { role: 'user' }, userId: actor })).toThrow('Merchant');
});
test('product filters escape search and validate price ranges', () => {
  expect(scope.productFilters({ search: 'a.*', minPrice: '100', maxPrice: '200' })).toEqual({ name: { $regex: 'a\\.\\*', $options: 'i' }, price: { $gte: 100, $lte: 200 } });
  expect(() => scope.productFilters({ minPrice: '200', maxPrice: '100' })).toThrow('Khoảng giá');
  expect(() => scope.productFilters({ brand: 'invalid' })).toThrow('ID');
});
test('brand assignment validates merchant and refuses conflicting existing product owners', async () => {
  jest.spyOn(User, 'exists').mockResolvedValue(true);
  jest.spyOn(Brand, 'findById').mockReturnValue({ select: () => Promise.resolve({ ownerId: actor }) });
  jest.spyOn(Product, 'exists').mockResolvedValue(true);
  await expect(scope.assertBrandAssignment(actor, target)).rejects.toMatchObject({ statusCode: 409 });
  expect(Product.exists).toHaveBeenCalled();
});
test('inactive or missing merchant cannot receive a brand', async () => {
  jest.spyOn(User, 'exists').mockResolvedValue(null);
  await expect(scope.assertMerchant(target)).rejects.toMatchObject({ statusCode: 400 });
});
test('admin rebranding cannot bypass the immutable direct product owner', async () => {
  jest.spyOn(Brand, 'findById').mockReturnValue({ select: () => Promise.resolve({ ownerId: target }) });
  await expect(scope.assertProductBrand({ ownerId: actor }, target)).rejects.toMatchObject({ statusCode: 409 });
  await expect(scope.assertProductBrand({ ownerId: target }, target)).resolves.toBeUndefined();
});
test('customer confirms only their paid online shipped order in one atomic update', async () => {
  role = 'user';
  const update = jest.spyOn(Order, 'findOneAndUpdate').mockResolvedValue({ _id: target, status: 'delivered' });
  const res = await request(app).post('/orders/' + target + '/confirm-receipt').set('Authorization', authorization());
  expect(res.status).toBe(200); expect(res.body.data.status).toBe('delivered');
  expect(update.mock.calls[0][0]).toEqual({ _id: target, userId: actor, status: 'shipped', paymentMethod: 'online', paymentStatus: 'paid' });
});
test.each([[null, 404], [{ status: 'shipped', paymentMethod: 'cod', paymentStatus: 'pending' }, 409], [{ status: 'pending', paymentMethod: 'online', paymentStatus: 'paid' }, 409], [{ status: 'delivered', paymentMethod: 'online', paymentStatus: 'paid' }, 200]])('receipt rejects foreign/COD/unshipped orders and handles repeated confirmation', async (current, expected) => {
  role = 'user'; jest.spyOn(Order, 'findOneAndUpdate').mockResolvedValue(null);
  jest.spyOn(Order, 'findOne').mockReturnValue({ select: () => Promise.resolve(current) });
  expect((await request(app).post('/orders/' + target + '/confirm-receipt').set('Authorization', authorization())).status).toBe(expected);
});
test('merchant cannot call admin merchant-options endpoint', async () => {
  expect((await request(app).get('/brands/merchant-options').set('Authorization', authorization())).status).toBe(403);
});
