const request = require('supertest');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct } = require('./helpers/factories');
const Product = require('../src/models/Product');
const Box = require('../src/models/Box');
const Category = require('../src/models/Category');
beforeAll(connect); afterEach(clearDatabase); afterAll(closeDatabase);
const auth = user => ({ Authorization: `Bearer ${signToken(user)}` });
async function fixture() {
  const { user: merchant } = await createUser({ role: 'merchant' });
  const { user: other } = await createUser({ role: 'merchant' });
  const brand = await createBrand({ ownerId: merchant._id });
  const product = await createProduct(brand, { price: 100000, stock: 100 });
  // Simulate migration of a legacy product.
  await Product.collection.updateOne({ _id: product._id }, { $set: { ownerId: merchant._id } });
  const combo = await Box.create({ ownerId: merchant._id, name: 'Combo A', descriptions: 'Combo', stock: 30, value: 200000, products: [{ productId: product._id, quantity: 2, price: 100000, name: product.name }], validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 86400000 * 365) });
  return { merchant, other, product, combo, brand };
}
test('merchant cannot enter admin routes or edit another merchant data', async () => {
  const { merchant, other, product, combo } = await fixture();
  expect((await request(app).get('/api/admin/orders').set(auth(merchant))).status).toBe(403);
  for (const [resource, id] of [['products', product._id], ['combos', combo._id]]) {
    expect((await request(app).delete(`/api/manager/${resource}/${id}`).set(auth(other))).status).toBe(404);
    expect((await request(app).get(`/api/manager/${resource}`).set(auth(other))).body.data).toEqual([]);
  }
  expect(await Product.exists({ _id: product._id, archivedAt: null })).toBeTruthy();
  const { user } = await createUser();
  expect((await request(app).get('/api/manager/products').set(auth(user))).status).toBe(403);
});
test('merchant product creation sets owner on server and rejects a foreign brand', async () => {
  const { merchant, other, brand } = await fixture();
  const category = await Category.create({ name: 'Food' });
  const input = { name: 'New product', description: 'Food', price: 10000, stock: 20, brand: String(brand._id), category: String(category._id), ownerId: String(other._id) };
  const created = await request(app).post('/api/manager/products').set(auth(merchant)).send(input);
  expect(created.status).toBe(201); expect(created.body.data.ownerId).toBe(String(merchant._id));
  expect((await request(app).post('/api/manager/products').set(auth(other)).send(input)).status).toBe(403);
});
test('multipart combo validates products and rejects products belonging to another merchant', async () => {
  const { merchant, other, product } = await fixture();
  const create = actor => request(app).post('/api/manager/combos').set(auth(actor)).field('name', 'New combo').field('descriptions', 'Combo').field('stock', '5').field('validTo', new Date(Date.now() + 86400000).toISOString()).field('products', JSON.stringify([{ productId: String(product._id), quantity: 2 }]));
  expect((await create(other)).status).toBe(403);
  const created = await create(merchant); expect(created.status).toBe(201); expect(created.body.data.value).toBe(200000);
});
test('gift derives combo, charges bulk discount and amenities in checkout quote', async () => {
  const { merchant, other, combo } = await fixture();
  const input = { name: 'Gift A', comboId: String(combo._id), stock: 10, validTo: new Date(Date.now() + 86400000).toISOString(), giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Thiệp', fee: 5000 }] } };
  expect((await request(app).post('/api/manager/gifts').set(auth(other)).send(input)).status).toBe(403);
  const gift = await request(app).post('/api/manager/gifts').set(auth(merchant)).send(input);
  expect(gift.status).toBe(201);
  const { user } = await createUser();
  const quote = await request(app).post('/api/checkout/quote').set(auth(user)).send({ items: [{ boxId: gift.body.data._id, quantity: 3 }] });
  expect(quote.status).toBe(200);
  expect(quote.body.data).toMatchObject({ subtotal: 540000, bulkDiscountAmount: 60000, giftFee: 15000, totalAmount: 555000 });
  expect((await request(app).get(`/api/boxes/public/${gift.body.data._id}`)).status).toBe(200);
});
test('retail monthly subscription uses owned products and transaction, hides internal box from public catalog', async () => {
  const { merchant, other, product } = await fixture();
  const input = { name: 'Monthly retail', products: [{ productId: String(product._id), quantity: 2 }], stock: 5, validTo: new Date(Date.now() + 86400000).toISOString(), planType: '3_month', discountPercent: 10 };
  expect((await request(app).post('/api/manager/retail-subscriptions').set(auth(other)).send(input)).status).toBe(403);
  const created = await request(app).post('/api/manager/retail-subscriptions').set(auth(merchant)).send(input);
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ sourceType: 'retail', basePrice: 600000, discountPrice: 540000, cadence: 'monthly' });
  expect((await request(app).get(`/api/boxes/public/${created.body.data.boxId}`)).status).toBe(404);
  const { user } = await createUser();
  const quote = await request(app).post('/api/checkout/quote').set(auth(user)).send({ items: [{ boxId: created.body.data.boxId, quantity: 1 }] });
  expect(quote.status).toBe(400);
});
