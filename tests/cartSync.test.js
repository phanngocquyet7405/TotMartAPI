const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../src/app");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
} = require("./helpers/factories");
const Cart = require("../src/models/Cart");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

const sync = (token, items) =>
  request(app)
    .put("/api/carts/sync")
    .set("Authorization", `Bearer ${token}`)
    .send({ items });

describe("PUT /api/carts/sync", () => {
  test("requires authentication", async () => {
    const res = await request(app).put("/api/carts/sync").send({ items: [] });
    expect(res.status).toBe(401);
  });

  test("creates the cart when the user has none", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 30000 });

    const res = await sync(token, [
      { productId: product._id.toString(), quantity: 2 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.skipped).toEqual([]);

    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
    expect(cart.totalPrice).toBe(60000);
  });

  test("replaces existing items instead of adding to them (idempotent)", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const a = await createProduct(brand, { price: 10000 });
    const b = await createProduct(brand, { price: 20000 });
    await createCartWithItems(user._id, [{ productId: a._id, quantity: 5 }]);

    const payload = [{ productId: b._id.toString(), quantity: 1 }];
    await sync(token, payload);
    const res = await sync(token, payload);

    expect(res.status).toBe(200);
    const carts = await Cart.find({ userId: user._id, isSubscribeCart: false });
    expect(carts).toHaveLength(1);
    expect(carts[0].items).toHaveLength(1);
    expect(String(carts[0].items[0].productId)).toBe(String(b._id));
    expect(carts[0].items[0].quantity).toBe(1);
    expect(carts[0].totalPrice).toBe(20000);
  });

  test("merges duplicate productId lines and prices with salePercent", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, {
      price: 100000,
      salePercent: 10,
    });

    const id = product._id.toString();
    const res = await sync(token, [
      { productId: id, quantity: 1 },
      { productId: id, quantity: 2 },
    ]);

    expect(res.status).toBe(200);
    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
    expect(cart.totalPrice).toBe(270000);
  });

  test("skips products that no longer exist and reports them", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand);
    const ghostId = new mongoose.Types.ObjectId().toString();

    const res = await sync(token, [
      { productId: product._id.toString(), quantity: 1 },
      { productId: ghostId, quantity: 1 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual([ghostId]);
    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart.items).toHaveLength(1);
  });

  test("empty items clears the cart", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand);
    await createCartWithItems(user._id, [
      { productId: product._id, quantity: 1 },
    ]);

    const res = await sync(token, []);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(await Cart.countDocuments({ userId: user._id })).toBe(0);
  });

  test("does not touch the subscribe cart", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand);
    await Cart.create({
      userId: user._id,
      items: [],
      totalPrice: 0,
      isSubscribeCart: true,
    });

    await sync(token, [{ productId: product._id.toString(), quantity: 1 }]);

    expect(
      await Cart.countDocuments({ userId: user._id, isSubscribeCart: true }),
    ).toBe(1);
    expect(
      await Cart.countDocuments({ userId: user._id, isSubscribeCart: false }),
    ).toBe(1);
  });

  test.each([
    ["quantity 0", { quantity: 0 }],
    ["negative quantity", { quantity: -1 }],
    ["non-integer quantity", { quantity: 1.5 }],
    ["quantity over 999", { quantity: 1000 }],
    ["invalid productId", { productId: "not-an-id" }],
  ])("rejects %s with 400", async (_label, override) => {
    const { user } = await createUser();
    const token = signToken(user);
    const item = {
      productId: new mongoose.Types.ObjectId().toString(),
      quantity: 1,
      ...override,
    };

    const res = await sync(token, [item]);
    expect(res.status).toBe(400);
  });

  test("checkout succeeds after syncing a localStorage-only cart (regression for 'Giỏ hàng trống')", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 30000, stock: 5 });

    await sync(token, [{ productId: product._id.toString(), quantity: 1 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.grandTotalAmount).toBe(60000); // 30k hàng + 30k ship
  });
});
