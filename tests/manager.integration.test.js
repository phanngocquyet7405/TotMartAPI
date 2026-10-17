const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const { createUser, createBrand, createProduct, signToken } = require('./helpers/factories');
const Box = require('../src/models/Box');
const Template = require('../src/models/SubscriptionTemplate');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Order = require('../src/models/Order');
const Checkout = require('../src/models/Checkout');
let merchant, other, customer, admin, brand, category, product;
const auth = user => ({ Authorization: `Bearer ${signToken(user)}` });
const multipart = (req, body) => Object.entries(body).reduce((r, [key, value]) => r.field(key, typeof value === 'object' ? JSON.stringify(value) : String(value)), req);
const comboInput = () => ({ name: 'Own combo', descriptions: 'Combo products', stock: 20, discountPercent: 0, validTo: '2099-01-01T00:00:00.000Z', products: [{ productId: String(product._id), quantity: 2 }] });
beforeAll(db.connect);
afterAll(db.closeDatabase);
beforeEach(async () => {
  await db.clearDatabase();
  merchant = (await createUser({ role: 'merchant' })).user;
  other = (await createUser({ role: 'merchant' })).user;
  customer = (await createUser()).user;
  admin = (await createUser({ role: 'admin' })).user;
  brand = await createBrand({ ownerId: merchant._id });
  category = await Category.create({ name: 'Manager fixture category' });
  product = await createProduct(brand, { price: 100000, stock: 100 });
});
test('manager role is isolated from guests, customers and admin; catalog is scoped', async () => {
  expect((await request(app).get('/api/manager/products')).status).toBe(401);
  for (const user of [customer, admin]) expect((await request(app).get('/api/manager/products').set(auth(user))).status).toBe(403);
  const result = await request(app).get('/api/manager/catalog-options').set(auth(merchant));
  expect(result.status).toBe(200); expect(result.body.data.brands.map(b => b._id)).toEqual([String(brand._id)]);
  expect((await request(app).get('/api/manager/products').set(auth(other))).body.pagination.total).toBe(0);
  expect((await request(app).post('/api/products/create-product').set(auth(merchant)).send({})).status).toBe(403);
  expect((await request(app).post('/api/checkout/check-out').set(auth(merchant)).send({})).status).toBe(403);
  expect((await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(merchant)).send({})).status).toBe(403);
});

test('admin and merchant edits reject foreign replacements and legacy mixed composition', async () => {
  const created = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput());
  expect(created.status).toBe(201);
  const id = created.body.data._id;
  const foreignBrand = await createBrand({ ownerId: other._id });
  const foreign = await createProduct(foreignBrand);
  const replacement = { products: [{ productId: String(foreign._id), quantity: 1 }] };
  expect((await request(app).put(`/api/boxes/update-box/${id}`).set(auth(admin)).send(replacement)).status).toBe(409);
  expect((await request(app).put(`/api/manager/combos/${id}`).set(auth(merchant)).send(replacement)).status).toBe(403);
  expect((await request(app).put(`/api/boxes/update-box/${id}`).set(auth(admin)).send({ name: 'Valid edit' })).status).toBe(200);
  await Box.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(id) },
    { $push: { products: { productId: foreign._id, quantity: 1, price: foreign.price, name: foreign.name } } });
  for (const [path, actor] of [[`/api/boxes/update-box/${id}`, admin], [`/api/manager/combos/${id}`, merchant]]) {
    const result = await request(app).put(path).set(auth(actor)).send({ name: 'Invalid legacy edit' });
    expect(result.status).toBe(409);
  }
  expect((await Box.findById(id)).name).toBe('Valid edit');
});

test('admin brand detail and owner assignment stay private and reject conflicting product ownership', async () => {
  const empty = await createBrand({ ownerId: merchant._id });
  const detail = await request(app).get(`/api/brands/manage/${empty._id}`).set(auth(admin));
  expect(detail.status).toBe(200); expect(detail.body.data.ownerId).toBe(String(merchant._id));
  const updated = await request(app).put(`/api/brands/update-brand/${empty._id}`).set(auth(admin)).send({ ownerId: String(other._id) });
  expect(updated.status).toBe(200);
  expect(String((await require('../src/models/Brand').findById(empty._id)).ownerId)).toBe(String(other._id));
  expect((await request(app).put(`/api/brands/update-brand/${brand._id}`).set(auth(admin)).send({ ownerId: String(other._id) })).status).toBe(409);
  const publicList = await request(app).get('/api/brands/get-all-brands');
  expect(publicList.body.data.every(b => b.ownerId === undefined)).toBe(true);
  expect((await request(app).get(`/api/brands/manage/${empty._id}`).set(auth(merchant))).status).toBe(403);
});
test('multipart products, owner assignment, refs, stock delta and IDOR', async () => {
  const input = { name: 'Merchant product', description: '<p>Good product</p>', stock: 5, price: 120000, brand: String(brand._id), category: String(category._id) };
  const created = await multipart(request(app).post('/api/manager/products').set(auth(merchant)), input);
  expect(created.status).toBe(201); expect(created.body.data.ownerId).toBe(String(merchant._id));
  const id = created.body.data._id;
  expect((await request(app).post('/api/manager/products').set(auth(other)).send(input)).status).toBe(403);
  expect((await request(app).put(`/api/manager/products/${id}`).set(auth(other)).send({ name: 'No access' })).status).toBe(404);
  const updated = await multipart(request(app).put(`/api/manager/products/${id}`).set(auth(merchant)), { name: 'Updated product', price: 110000 });
  expect(updated.status).toBe(200); expect(updated.body.data.stock).toBe(5);
  expect((await request(app).patch(`/api/manager/products/${id}/stock`).set(auth(merchant)).send({ delta: 3 })).body.data.stock).toBe(8);
  expect((await request(app).patch(`/api/manager/products/${id}/stock`).set(auth(merchant)).send({ delta: -9 })).status).toBe(409);
  expect((await request(app).patch(`/api/manager/products/${id}/stock`).set(auth(other)).send({ delta: 1 })).status).toBe(404);
  expect((await request(app).put(`/api/manager/products/${id}`).set(auth(merchant)).send({ ownerId: other._id, stock: 999 })).status).toBe(400);
  const listed = await request(app).get('/api/manager/products?keyword=Updated&limit=1').set(auth(merchant));
  expect(listed.body.pagination.total).toBe(1); expect(typeof listed.body.data[0].brand).toBe('string');
});
test('owned combo to gift, real quote, no double discount and definition version', async () => {
  const combo = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput());
  expect(combo.status).toBe(201); expect(combo.body.data.value).toBe(200000);
  const id = combo.body.data._id;
  const edit = await multipart(request(app).put(`/api/manager/combos/${id}`).set(auth(merchant)), { name: 'Updated combo' });
  expect(edit.status).toBe(200); expect(edit.body.data.definitionVersion).toBe(2);
  const giftInput = { name: 'Merchant gift', comboId: id, stock: 10, validTo: comboInput().validTo,
    giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Thiệp', fee: 5000 }] } };
  const gift = await request(app).post('/api/manager/gifts').set(auth(merchant)).send(giftInput);
  expect(gift.status).toBe(201); expect(gift.body.data.sourceComboId).toBe(id);
  expect((await request(app).get(`/api/boxes/public/${gift.body.data._id}`)).status).toBe(200);
  expect((await request(app).post('/api/manager/gifts').set(auth(other)).send(giftInput)).status).toBe(403);
  const quote = await request(app).post('/api/checkout/quote').set(auth(merchant)).send({ items: [{ boxId: gift.body.data._id, quantity: 3 }] });
  expect(quote.status).toBe(200);
  expect(quote.body.data).toMatchObject({ totalAmount: 555000, bulkDiscountAmount: 60000, giftFee: 15000, subtotal: 540000 });
  expect((await request(app).get('/api/manager/combos?kind=gift').set(auth(merchant))).body.pagination.total).toBe(1);
  expect((await request(app).get('/api/manager/gifts').set(auth(merchant))).body.pagination.total).toBe(1);
  expect((await request(app).patch(`/api/manager/gifts/${gift.body.data._id}`).set(auth(merchant)).send({ name: 'Updated gift' })).status).toBe(200);
});
test('reject foreign constituent IDs and forged owner; retail source remains internal', async () => {
  const foreignBrand = await createBrand({ ownerId: other._id });
  const foreign = await createProduct(foreignBrand);
  expect((await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), { ...comboInput(), products: [{ productId: String(foreign._id), quantity: 1 }] })).status).toBe(403);
  const retail = await request(app).post('/api/manager/retail-subscriptions').set(auth(merchant)).send({ name: 'Retail monthly', products: [{ productId: String(product._id), quantity: 1 }], stock: 10, validTo: comboInput().validTo, planType: '3_month', discountPercent: 10 });
  expect(retail.status).toBe(201); expect(retail.body.data).toMatchObject({ sourceType: 'retail', basePrice: 300000, discountPrice: 270000 });
  const id = retail.body.data._id;
  expect((await request(app).patch(`/api/manager/subscriptions/${id}`).set(auth(merchant)).send({ name: 'Renamed retail' })).body.data.sourceType).toBe('retail');
  expect((await request(app).get('/api/manager/combos').set(auth(merchant))).body.pagination.total).toBe(0);
  expect((await request(app).patch(`/api/manager/retail-subscriptions/${id}/stock`).set(auth(merchant)).send({ delta: 2 })).body.data.stock).toBe(12);
  expect((await request(app).patch(`/api/manager/retail-subscriptions/${id}/stock`).set(auth(other)).send({ delta: 2 })).status).toBe(404);
  expect((await request(app).get('/api/boxes/get-all-box')).body.data).toHaveLength(0);
  expect((await request(app).get(`/api/boxes/get-products-in-box/${retail.body.data.boxId}`)).status).toBe(404);
  expect((await request(app).post('/api/checkout/quote').set(auth(customer)).send({ items: [{ boxId: retail.body.data.boxId, quantity: 1 }] })).status).toBe(400);
  expect((await request(app).delete(`/api/manager/subscriptions/${id}`).set(auth(other))).status).toBe(404);
  expect((await request(app).delete(`/api/manager/subscriptions/${id}`).set(auth(merchant))).status).toBe(200);
  expect((await request(app).get('/api/subcribe-plans/get-active-subscribe')).body.data).toHaveLength(0);
});
async function orderFixture(overrides = {}) {
  const code = 'TMART' + Date.now();
  const order = await Order.create({ userId: customer._id, merchantId: merchant._id, orderId: code, paymentCode: code,
    totalAmount: 100000, stockDeducted: true, customerEmail: customer.email,
    products: [{ productId: product._id, name: product.name, quantity: 1, unitPrice: 100000, totalPrice: 100000 }], ...overrides });
  await Checkout.create({ userId: customer._id, requestKey: code, requestHash: code, paymentCode: code, orderIds: [order._id], totalAmount: 100000, paymentMethod: order.paymentMethod, expiresAt: new Date(Date.now() + 3600000), result: {} });
  return order;
}
test('merchant COD lifecycle separates delivered from paid; admin alone settles COD', async () => {
  const order = await orderFixture(); const url = `/api/manager/orders/${order._id}/status`;
  expect((await request(app).patch(url).set(auth(other)).send({ status: 'processing' })).status).toBe(404);
  for (const status of ['processing', 'shipped', 'delivered']) {
    const response = await request(app).patch(url).set(auth(merchant)).send({ status });
    expect(response.status).toBe(200); expect(response.body.data.status).toBe(status);
    expect(response.body.data.paymentStatus).toBe('pending');
  }
  const current = await Order.findById(order._id);
  expect(current.codCollectionStatus).toBe('pending_review'); expect(current.paidAt).toBeNull();
  const historyLength = current.statusHistory.length;
  expect((await request(app).patch(url).set(auth(merchant)).send({ status: 'delivered' })).status).toBe(200);
  expect((await Order.findById(order._id)).statusHistory.length).toBe(historyLength);
  expect((await request(app).post(`/api/checkout/mark-cod-delivered/${order._id}`).set(auth(merchant))).status).toBe(403);
  const settled = await request(app).post(`/api/checkout/mark-cod-delivered/${order._id}`).set(auth(admin));
  expect(settled.status).toBe(200); expect(settled.body.data.paymentStatus).toBe('paid');
  expect(settled.body.data.codCollectionStatus).toBe('confirmed');
  const settledHistory = (await Order.findById(order._id)).statusHistory.length;
  expect((await request(app).post(`/api/checkout/mark-cod-delivered/${order._id}`).set(auth(admin))).status).toBe(200);
  expect((await Order.findById(order._id)).statusHistory.length).toBe(settledHistory);
  expect((await Product.findById(product._id)).stock).toBe(100);
});
test('unpaid online hidden by default, explicit filter/projection and mutation denies finance fields', async () => {
  const order = await orderFixture({ paymentMethod: 'online', stockDeducted: false });
  const list = await request(app).get('/api/manager/orders').set(auth(merchant));
  expect(list.body.pagination.total).toBe(0); expect(list.body.meta.hiddenUnpaidOnline).toBe(1);
  const explicit = await request(app).get('/api/manager/orders?includeUnpaid=true&search=TMART').set(auth(merchant));
  expect(explicit.body.data[0].customerEmail).toBeUndefined(); expect(explicit.body.data[0].paymentCode).toBeUndefined();
  expect(explicit.body.data[0].allowedTransitions).toEqual([]);
  const url = `/api/manager/orders/${order._id}/status`;
  expect((await request(app).patch(url).set(auth(merchant)).send({ status: 'processing' })).status).toBe(409);
  expect((await request(app).patch(url).set(auth(merchant)).send({ status: 'delivered', paymentStatus: 'paid' })).status).toBe(400);
  expect((await request(app).patch(url).set(auth(merchant)).send({ status: 'cancelled' })).status).toBe(400);
  expect((await request(app).get('/api/manager/orders?from=2026-12-31&to=2026-01-01').set(auth(merchant))).status).toBe(400);
});
test('owned combo metadata is locked by real order obligations', async () => {
  const combo = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput());
  const order = await orderFixture({ boxes: [{ boxId: combo.body.data._id, name: 'Own combo', quantity: 1 }] });
  expect(order._id).toBeDefined();
  expect((await multipart(request(app).put(`/api/manager/combos/${combo.body.data._id}`).set(auth(merchant)), { name: 'Locked rename' })).status).toBe(409);
  expect((await request(app).delete(`/api/manager/products/${product._id}`).set(auth(merchant))).status).toBe(409);
});
test('online paid transitions audit actors and rejects stale state without touching finance', async () => {
  const order = await orderFixture({ paymentMethod: 'online', paymentStatus: 'paid', status: 'processing' });
  const url = `/api/manager/orders/${order._id}/status`;
  const ship = await request(app).patch(url).set(auth(merchant)).send({ status: 'shipped', expectedStatus: 'processing', trackingReference: 'SHIP-TEST' });
  expect(ship.status).toBe(200); expect(ship.body.data.trackingReference).toBe('SHIP-TEST');
  expect((await request(app).patch(url).set(auth(merchant)).send({ status: 'delivered', expectedStatus: 'processing' })).status).toBe(409);
  const results = await Promise.all([1, 2].map(() => request(app).patch(url).set(auth(merchant)).send({ status: 'delivered' })));
  expect(results.map(r => r.status)).toEqual([200, 200]);
  const saved = await Order.findById(order._id);
  expect(saved.statusHistory.filter(h => h.status === 'delivered')).toHaveLength(1);
  expect(String(saved.statusHistory.at(-1).changedBy)).toBe(String(merchant._id));
  expect(saved.paymentStatus).toBe('paid'); expect(saved.totalAmount).toBe(100000);
});
test('admin can provision merchant brand and manage gifts; merchant cannot use admin paths', async () => {
  const provision = await request(app).post(`/api/admin/merchants/${other._id}/brands`).set(auth(admin)).send({ name: 'Provisioned merchant brand' });
  expect(provision.status).toBe(201); expect(provision.body.data.ownerId).toBe(String(other._id));
  expect((await request(app).get('/api/admin/gifts').set(auth(merchant))).status).toBe(403);
  const combo = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput());
  const gift = await request(app).post('/api/admin/gifts').set(auth(admin)).send({ name: 'Admin created gift', comboId: combo.body.data._id, stock: 5, validTo: comboInput().validTo });
  expect(gift.status).toBe(201); expect(gift.body.data.ownerId).toBe(String(merchant._id));
  expect((await request(app).patch(`/api/admin/gifts/${gift.body.data._id}`).set(auth(admin)).send({ name: 'Admin updated gift' })).status).toBe(200);
  expect((await request(app).delete(`/api/admin/gifts/${gift.body.data._id}`).set(auth(admin))).status).toBe(200);
});
test('failed multi-image upload is cleaned up, bad MIME/size never reaches Cloudinary', async () => {
  const cloud = require('cloudinary').v2.uploader;
  const { Writable } = require('node:stream');
  let calls = 0;
  const upload = jest.spyOn(cloud, 'upload_stream').mockImplementation((options, callback) => new Writable({
    write(chunk, encoding, done) { done(); },
    final(done) { calls++; callback(calls === 2 ? new Error('Synthetic upload failure') : null,
      { secure_url: 'https://test.invalid/fixture.webp', public_id: 'test-fixture-image' }); done(); },
  }));
  const destroy = jest.spyOn(cloud, 'destroy').mockResolvedValue({ result: 'ok' });
  try {
    const response = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput())
      .attach('images', Buffer.from('fixture'), { filename: 'first.png', contentType: 'image/png' })
      .attach('images', Buffer.from('fixture'), { filename: 'second.png', contentType: 'image/png' });
    expect(response.status).toBe(500); expect(destroy).toHaveBeenCalledWith('test-fixture-image');
    expect(await Box.countDocuments()).toBe(0);
    upload.mockClear();
    expect((await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput())
      .attach('images', Buffer.from('fixture'), { filename: 'bad.svg', contentType: 'image/svg+xml' })).status).toBe(400);
    expect((await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput())
      .attach('images', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' })).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  } finally { upload.mockRestore(); destroy.mockRestore(); }
});
test('ownership migration is read-only by default, repeatable and leaves mixed boxes unassigned', async () => {
  const foreignBrand = await createBrand({ ownerId: other._id });
  const foreign = await createProduct(foreignBrand);
  const own = await Box.create({ ...comboInput(), products: [{ productId: product._id, quantity: 1, price: product.price, name: product.name }], validFrom: new Date(), value: 100000 });
  const mixed = await Box.create({ ...comboInput(), name: 'Mixed legacy', products: [
    { productId: product._id, quantity: 1, price: product.price, name: product.name },
    { productId: foreign._id, quantity: 1, price: foreign.price, name: foreign.name },
  ], validFrom: new Date(), value: 200000 });
  const template = await Template.create({ name: 'Legacy template', boxId: own._id, planType: '1_month', basePrice: 100000, discountPrice: 100000 });
  const { migrate } = require('../scripts/migrate-merchant-ownership');
  const preview = await migrate();
  expect(preview.mode).toBe('read_only'); expect((await Box.findById(own._id)).ownerId).toBeUndefined();
  expect(preview.unresolved.some(row => row.id === String(mixed._id))).toBe(true);
  await migrate({ apply: true });
  expect(String((await Box.findById(own._id)).ownerId)).toBe(String(merchant._id));
  expect((await Box.findById(mixed._id)).ownerId).toBeUndefined();
  expect(String((await Template.findById(template._id)).ownerId)).toBe(String(merchant._id));
  expect((await migrate({ apply: true })).changes).toHaveLength(0);
  expect((await Product.findById(product._id)).stock).toBe(100);
});
test('customer gift checkout persists server prices, reserves and restores only once', async () => {
  const combo = await multipart(request(app).post('/api/manager/combos').set(auth(merchant)), comboInput());
  const gift = await request(app).post('/api/manager/gifts').set(auth(merchant)).send({ name: 'Checkout gift', comboId: combo.body.data._id,
    stock: 10, validTo: comboInput().validTo, giftPolicy: { bulkTiers: [{ minQuantity: 3, percent: 10 }], amenities: [{ name: 'Thiệp', fee: 5000 }] } });
  const id = gift.body.data._id, items = [{ boxId: id, quantity: 3 }];
  const quote = await request(app).post('/api/checkout/quote').set(auth(customer)).send({ items });
  expect((await request(app).put('/api/carts/sync').set(auth(customer)).send({ items, version: 0 })).status).toBe(200);
  const payload = { addressId: String(customer.addresses[0]._id), paymentMethod: 'cod', quoteFingerprint: quote.body.data.fingerprint };
  const place = () => request(app).post('/api/checkout/check-out').set(auth(customer)).set('Idempotency-Key', 'gift-checkout-fixture').send(payload);
  const first = await place(), retry = await place();
  expect(first.status).toBe(201); expect(retry.status).toBe(201);
  expect(first.body.data).toMatchObject({ totalAmount: 555000 });
  expect(retry.body.data.orderCode).toBe(first.body.data.orderCode);
  const order = await Order.findById(first.body.data.orderId);
  expect(order).toMatchObject({ totalAmount: 555000, giftFee: 15000, bulkDiscountAmount: 60000 });
  expect(String(order.merchantId)).toBe(String(merchant._id));
  expect((await Product.findById(product._id)).stock).toBe(94); expect((await Box.findById(id)).stock).toBe(7);
  expect((await request(app).post(`/api/checkout/cancel/${order._id}`).set(auth(merchant)).send({ reason: 'Not allowed' })).status).toBe(403);
  expect((await request(app).post(`/api/checkout/cancel/${order._id}`).set(auth(customer)).send({ reason: 'Fixture cancel' })).status).toBe(200);
  expect((await Product.findById(product._id)).stock).toBe(100); expect((await Box.findById(id)).stock).toBe(10);
});
test('retail template is purchasable through existing prepaid subscription lifecycle with pinned contents', async () => {
  const retail = await request(app).post('/api/manager/retail-subscriptions').set(auth(merchant)).send({ name: 'Retail purchase fixture', products: [{ productId: String(product._id), quantity: 1 }], stock: 10, validTo: comboInput().validTo, planType: '3_month', discountPercent: 10 });
  expect(retail.status).toBe(201);
  const response = await request(app).post('/api/subcribe-plans/user-subscribe').set(auth(customer)).set('Idempotency-Key', 'retail-purchase-fixture')
    .send({ templateId: retail.body.data._id, expectedTotalAmount: 270000, shippingAddress: customer.addresses[0].toObject() });
  expect(response.status).toBe(201);
  const sub = await require('../src/models/UserSubscription').findOne({ userId: customer._id });
  expect(sub.price).toBe(270000); expect(sub.totalDeliveries).toBe(3); expect(sub.boxVersionId).toBeDefined();
  expect(sub.status).toBe('pending_payment');
  expect((await Product.findById(product._id)).stock).toBe(100);
});
