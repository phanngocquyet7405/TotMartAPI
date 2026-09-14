const request = require("supertest");
const app = require("../src/app");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
} = require("./helpers/factories");
const Order = require("../src/models/Order");
const Product = require("../src/models/Product");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function webhookPayload({ paymentCode, amount, referenceCode, transferType = "in" }) {
  return {
    id: Math.floor(Math.random() * 1000000),
    gateway: "TestBank",
    transactionDate: new Date().toISOString(),
    accountNumber: process.env.SEPAY_BANK_ACCOUNT,
    content: `Chuyen khoan ${paymentCode}`,
    code: paymentCode,
    transferType,
    transferAmount: amount,
    referenceCode,
  };
}

async function placeOnlineOrder(overrides = {}) {
  const { user } = await createUser();
  const token = signToken(user);
  const brand = await createBrand();
  const product = await createProduct(brand, {
    price: overrides.price ?? 100000,
    stock: overrides.stock ?? 5,
  });
  await createCartWithItems(user._id, [
    { productId: product._id, quantity: overrides.quantity ?? 1 },
  ]);

  const res = await request(app)
    .post("/api/checkout/check-out")
    .set("Authorization", `Bearer ${token}`)
    .send({ addressId: user.addresses[0]._id.toString(), paymentMethod: "online" });

  return {
    user,
    product,
    paymentCode: res.body.data.paymentCode,
    grandTotalAmount: res.body.data.grandTotalAmount,
  };
}

describe("POST /api/checkout/sepay-webhook", () => {
  test("rejects a call with no API key", async () => {
    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .send(webhookPayload({ paymentCode: "TMARTX", amount: 1000, referenceCode: "R1" }));
    expect(res.status).toBe(401);
  });

  test("marks the matching order paid, deducts stock at payment time, and is reflected via the order status", async () => {
    const { paymentCode, grandTotalAmount, product } = await placeOnlineOrder({ stock: 5, quantity: 1 });

    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(webhookPayload({ paymentCode, amount: grandTotalAmount, referenceCode: "REF-PAID-1" }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const order = await Order.findOne({ paymentCode });
    expect(order.paymentStatus).toBe("paid");
    expect(order.status).toBe("processing");
    expect(order.stockDeducted).toBe(true);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(4);
  });

  test("is idempotent — replaying the same reference code does not reprocess the order", async () => {
    const { paymentCode, grandTotalAmount, product } = await placeOnlineOrder({ stock: 5, quantity: 1 });
    const payload = webhookPayload({ paymentCode, amount: grandTotalAmount, referenceCode: "REF-DUP-1" });

    const first = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(payload);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.message).toMatch(/already processed/i);

    const updatedProduct = await Product.findById(product._id);
    // Nếu bị xử lý 2 lần, số lượng sẽ bị trừ thành 3 thay vì 4
    expect(updatedProduct.stock).toBe(4);
  });

  test("flags an underpaid transfer for manual review instead of marking the order paid", async () => {
    const { paymentCode, grandTotalAmount, product } = await placeOnlineOrder({ stock: 5, quantity: 1 });

    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(
        webhookPayload({
          paymentCode,
          amount: grandTotalAmount - 10000,
          referenceCode: "REF-UNDERPAY-1",
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/underpaid/i);

    const order = await Order.findOne({ paymentCode });
    expect(order.paymentStatus).toBe("pending");

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(5);
  });

  test("ignores outgoing transfers", async () => {
    const { paymentCode, grandTotalAmount } = await placeOnlineOrder();

    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(
        webhookPayload({
          paymentCode,
          amount: grandTotalAmount,
          referenceCode: "REF-OUT-1",
          transferType: "out",
        }),
      );

    expect(res.status).toBe(200);
    const order = await Order.findOne({ paymentCode });
    expect(order.paymentStatus).toBe("pending");
  });

  test("a fully paid order can be cancelled and is flagged for refund", async () => {
    const { paymentCode, grandTotalAmount } = await placeOnlineOrder({ stock: 5, quantity: 1 });
    await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(webhookPayload({ paymentCode, amount: grandTotalAmount, referenceCode: "REF-REFUND-1" }));

    const order = await Order.findOne({ paymentCode });
    const User = require("../src/models/User");
    const user = await User.findById(order.userId);
    const token = signToken(user);

    const res = await request(app)
      .post(`/api/checkout/cancel/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Khách đổi ý sau khi đã thanh toán" });

    expect(res.status).toBe(200);
    const cancelled = await Order.findById(order._id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.refundStatus).toBe("pending");
    expect(cancelled.refundAmount).toBe(order.totalAmount);
  });
});
