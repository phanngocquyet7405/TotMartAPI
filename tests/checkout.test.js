const request = require("supertest");
const app = require("../src/app");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
  createCoupon,
} = require("./helpers/factories");
const Product = require("../src/models/Product");
const Order = require("../src/models/Order");
const Cart = require("../src/models/Cart");
const Coupon = require("../src/models/Coupon");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("POST /api/checkout/check-out", () => {
  test("rejects when the cart is empty (regression test for the isSubscribeCart field-name bug)", async () => {
    const { user } = await createUser();
    const token = signToken(user);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "cod" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("places a COD order, deducts stock immediately, and empties the cart", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "cod" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(1);
    expect(res.body.data.grandTotalAmount).toBe(100000);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(3);

    const order = await Order.findOne({ userId: user._id });
    expect(order.status).toBe("pending");
    expect(order.paymentStatus).toBe("pending");
    expect(order.stockDeducted).toBe(true);

    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart.items).toHaveLength(0);
  });

  test("does NOT deduct stock for an online order until payment is confirmed", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "online" });

    expect(res.status).toBe(200);
    expect(res.body.data.qrUrl).toBeDefined();

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(5);

    const order = await Order.findOne({ userId: user._id });
    expect(order.stockDeducted).toBe(false);
    expect(order.paymentStatus).toBe("pending");
  });

  test("rejects checkout when the requested quantity exceeds available stock, without mutating stock", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 1 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 5 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "cod" });

    expect(res.status).toBe(400);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(1);
    expect(await Order.countDocuments({})).toBe(0);
  });

  test("rejects checkout with an invalid addressId", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand);
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: "507f1f77bcf86cd799439011", paymentMethod: "cod" });

    expect(res.status).toBe(400);
  });

  test("splits an order per merchant when the cart mixes products from different brands", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brandA = await createBrand();
    const brandB = await createBrand();
    const productA = await createProduct(brandA, { price: 100000, stock: 5 });
    const productB = await createProduct(brandB, { price: 200000, stock: 5 });
    await createCartWithItems(user._id, [
      { productId: productA._id, quantity: 1 },
      { productId: productB._id, quantity: 1 },
    ]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "cod" });

    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(2);
    expect(res.body.data.grandTotalAmount).toBe(300000);

    const orders = await Order.find({ userId: user._id });
    const merchantIds = new Set(orders.map((o) => o.merchantId.toString()));
    expect(merchantIds.size).toBe(2);
  });

  test("applies a valid percentage coupon and increments its usage count", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const coupon = await createCoupon({ discountType: "percentage", discount: 10 });

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
        couponCode: coupon.code,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.grandTotalAmount).toBe(90000);

    const updatedCoupon = await Coupon.findById(coupon._id);
    expect(updatedCoupon.usedCount).toBe(1);
  });

  test("rejects an expired coupon without deducting stock or coupon usage", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const coupon = await createCoupon({
      startDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
        couponCode: coupon.code,
      });

    expect(res.status).toBe(400);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(5);
    const updatedCoupon = await Coupon.findById(coupon._id);
    expect(updatedCoupon.usedCount).toBe(0);
  });

  test("a coupon at its usage limit is rejected on the next attempt", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    const coupon = await createCoupon({ usageLimit: 1 });

    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const first = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
        couponCode: coupon.code,
      });
    expect(first.status).toBe(200);

    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const second = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
        couponCode: coupon.code,
      });
    expect(second.status).toBe(409);
  });
});

describe("POST /api/checkout/cancel/:_id", () => {
  test("cancelling a pending COD order restores stock", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const checkoutRes = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "cod" });

    const order = await Order.findOne({ orderId: checkoutRes.body.data.orders[0] });
    expect((await Product.findById(product._id)).stock).toBe(3);

    const cancelRes = await request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Đổi ý" });

    expect(cancelRes.status).toBe(200);
    const restoredProduct = await Product.findById(product._id);
    expect(restoredProduct.stock).toBe(5);
  });

  test("a user cannot cancel another user's order", async () => {
    const { user: owner } = await createUser();
    const { user: intruder } = await createUser();
    const intruderToken = signToken(intruder);
    const brand = await createBrand();
    const product = await createProduct(brand, { stock: 5 });
    await createCartWithItems(owner._id, [{ productId: product._id, quantity: 1 }]);

    const checkoutRes = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${signToken(owner)}`)
      .send({ addressId: owner.addresses[0]._id.toString(), paymentMethod: "cod" });
    const order = await Order.findOne({ orderId: checkoutRes.body.data.orders[0] });

    const res = await request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set("Authorization", `Bearer ${intruderToken}`)
      .send({ reason: "n/a" });

    expect(res.status).toBe(403);
  });
});
