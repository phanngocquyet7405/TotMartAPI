const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');
const { createUser, signToken, createBrand, createProduct } = require('./helpers/factories');
const Cart = require('../src/models/Cart');
const Box = require('../src/models/Box');
const SubscriptionTemplate = require('../src/models/SubscriptionTemplate');

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Cart Validation and Concurrency Hardening (Phase 4)', () => {
  describe('Input Validation on Cart Endpoints', () => {
    test.each([
      ['invalid productId', { productId: 'not-a-valid-hex-id', quantity: 1 }],
      ['negative quantity', { quantity: -1 }],
      ['zero quantity', { quantity: 0 }],
      ['quantity over 999', { quantity: 1000 }],
      ['non-integer quantity', { quantity: 2.5 }],
    ])('POST /api/carts/add-to-cart rejects %s with 400', async (_label, override) => {
      const { user } = await createUser();
      const token = signToken(user);
      const brand = await createBrand();
      const product = await createProduct(brand);

      const payload = {
        productId: product._id.toString(),
        quantity: 1,
        ...override,
      };

      const res = await request(app).post('/api/carts/add-to-cart').set(auth(token)).send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test.each([
      ['negative quantity', { quantity: -1 }],
      ['zero quantity', { quantity: 0 }],
      ['quantity over 999', { quantity: 1000 }],
    ])('PUT /api/carts/update-cart/:_id rejects %s with 400', async (_label, payload) => {
      const { user } = await createUser();
      const token = signToken(user);
      const brand = await createBrand();
      const product = await createProduct(brand);

      const res = await request(app)
        .put(`/api/carts/update-cart/${product._id}`)
        .set(auth(token))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PUT /api/carts/update-cart/:_id rejects invalid param _id with 400', async () => {
      const { user } = await createUser();
      const token = signToken(user);

      const res = await request(app)
        .put('/api/carts/update-cart/invalid-param-id')
        .set(auth(token))
        .send({ quantity: 2 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('DELETE /api/carts/delete-from-cart/:_id rejects invalid param _id with 400', async () => {
      const { user } = await createUser();
      const token = signToken(user);

      const res = await request(app)
        .delete('/api/carts/delete-from-cart/invalid-param-id')
        .set(auth(token));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test.each([
      ['invalid subscriptionPlanId', { subscriptionPlanId: 'not-hex-id', quantity: 1 }],
      ['negative quantity', { quantity: -2 }],
      ['zero quantity', { quantity: 0 }],
      ['quantity over 999', { quantity: 1000 }],
      ['non-integer quantity', { quantity: 1.5 }],
    ])(
      'POST /api/carts/add-subscribe-plan-to-cart rejects %s with 400',
      async (_label, override) => {
        const { user } = await createUser();
        const token = signToken(user);
        const validId = new mongoose.Types.ObjectId().toString();

        const payload = {
          subscriptionPlanId: validId,
          quantity: 1,
          ...override,
        };

        const res = await request(app)
          .post('/api/carts/add-subscribe-plan-to-cart')
          .set(auth(token))
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );

    test.each([
      ['invalid subscriptionPlanId', { subscriptionPlanId: 'not-hex-id', quantity: 1 }],
      ['negative quantity', { quantity: -1 }],
      ['zero quantity', { quantity: 0 }],
      ['quantity over 999', { quantity: 1000 }],
    ])('PUT /api/carts/update-subscribe-cart rejects %s with 400', async (_label, override) => {
      const { user } = await createUser();
      const token = signToken(user);
      const validId = new mongoose.Types.ObjectId().toString();

      const payload = {
        subscriptionPlanId: validId,
        quantity: 1,
        ...override,
      };

      const res = await request(app)
        .put('/api/carts/update-subscribe-cart')
        .set(auth(token))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('DELETE /api/carts/delete-from-subscribe-cart/:_id rejects invalid param _id with 400', async () => {
      const { user } = await createUser();
      const token = signToken(user);

      const res = await request(app)
        .delete('/api/carts/delete-from-subscribe-cart/invalid-param-id')
        .set(auth(token));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Concurrency Hardening (Lost Update Prevention)', () => {
    test('10 concurrent add-to-cart requests on non-existent cart result in exact sum of quantities', async () => {
      const { user } = await createUser();
      const token = signToken(user);
      const brand = await createBrand();
      const product = await createProduct(brand, { price: 50000, stock: 100 });
      const productId = product._id.toString();

      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/carts/add-to-cart')
          .set(auth(token))
          .send({ productId, quantity: 2 }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
      }

      const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
      expect(cart).not.toBeNull();
      expect(cart.items).toHaveLength(1);
      // 10 concurrent requests of quantity 2 each => total quantity must be exactly 20
      expect(cart.items[0].quantity).toBe(20);

      // Total price: 20 * 50000 = 1,000,000. Bulk discount >= 5 items gives 10% off => 900,000
      expect(cart.totalPrice).toBe(900000);
    });

    test('10 concurrent add-to-cart requests on an existing cart result in exact sum of quantities', async () => {
      const { user } = await createUser();
      const token = signToken(user);
      const brand = await createBrand();
      const product = await createProduct(brand, { price: 20000, stock: 100 });
      const productId = product._id.toString();

      // Seed cart with initial quantity 3
      const initRes = await request(app)
        .post('/api/carts/add-to-cart')
        .set(auth(token))
        .send({ productId, quantity: 3 });
      expect([200, 201]).toContain(initRes.status);

      // Now fire 10 concurrent requests each adding quantity = 1
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/carts/add-to-cart')
          .set(auth(token))
          .send({ productId, quantity: 1 }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
      expect(cart).not.toBeNull();
      expect(cart.items).toHaveLength(1);
      // 3 + 10 * 1 = 13
      expect(cart.items[0].quantity).toBe(13);
      // 13 * 20000 = 260,000 with 10% bulk discount => 234,000
      expect(cart.totalPrice).toBe(234000);
    });

    test('10 concurrent add-subscribe-cart requests on brand new cart result in exact sum of quantities', async () => {
      const { user } = await createUser();
      const token = signToken(user);
      const brand = await createBrand();
      const product = await createProduct(brand, { price: 50000 });
      const box = await Box.create({
        ownerId: brand.ownerId,
        name: 'Sub Box',
        descriptions: 'Test box',
        stock: 50,
        validFrom: new Date(Date.now() - 10000),
        validTo: new Date(Date.now() + 86400000),
        value: 50000,
        products: [
          { productId: product._id, quantity: 1, price: product.price, name: product.name },
        ],
      });

      const template = await SubscriptionTemplate.create({
        ownerId: brand.ownerId,
        name: 'Weekly Box Plan',
        boxId: box._id,
        planType: '1_month',
        basePrice: 100000,
        discountPercent: 10,
        discountPrice: 90000,
      });

      const subscriptionPlanId = template._id.toString();

      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/carts/add-subscribe-plan-to-cart')
          .set(auth(token))
          .send({ subscriptionPlanId, quantity: 1 }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
      }

      const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: true });
      expect(cart).not.toBeNull();
      expect(cart.items).toHaveLength(1);
      // 10 concurrent requests of quantity 1 => exactly 10
      expect(cart.items[0].quantity).toBe(10);
      expect(cart.totalPrice).toBe(900000); // 10 * 90000
    });
  });
});
