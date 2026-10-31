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
const Order = require("../src/models/Order");
const Product = require("../src/models/Product");
const Checkout = require("../src/models/Checkout");
const Coupon = require("../src/models/Coupon");
const Cart = require("../src/models/Cart");
const NotificationOutbox = require("../src/models/NotificationOutbox");
const ReceiptRefund = require("../src/models/ReceiptRefund");
const { expireCheckout } = require("../src/jobs/orderExpiryScheduler");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function webhookPayload({
  paymentCode,
  amount,
  referenceCode,
  transferType = "in",
}) {
  return {
    id: Math.floor(Math.random() * 10000000),
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

describe("End-to-End Checkout Session & Online SePay Webhook Flow", () => {
  test("1. Tạo session: không tạo Order, không trừ kho, giữ nguyên giỏ hàng, trả về qrUrl và expiresAt", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 80000, stock: 10 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBeDefined();
    expect(res.body.data.paymentCode).toMatch(/^TMART/);
    expect(res.body.data.totalAmount).toBe(160000);
    expect(res.body.data.qrUrl).toMatch(/^https:\/\/qr\.sepay\.vn\/img\?/);
    expect(res.body.data.status).toBe("pending_payment");
    expect(res.body.data.expiresAt).toBeDefined();

    // Verify DB: No Order created
    const orderCount = await Order.countDocuments({ userId: user._id });
    expect(orderCount).toBe(0);

    // Verify DB: Stock untouched
    const freshProduct = await Product.findById(product._id);
    expect(freshProduct.stock).toBe(10);

    // Verify DB: Cart still exists
    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart).not.toBeNull();
    expect(cart.items).toHaveLength(1);
  });

  test("2. Huỷ session: khách huỷ phiên, chuyển trạng thái cancelled, nhả coupon, không thể huỷ lần 2", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 5 });
    await createCoupon({ code: "CANCELCOUPON", discount: 10 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const createRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: "CANCELCOUPON" });

    const { paymentCode } = createRes.body.data;
    expect((await Coupon.findOne({ code: "CANCELCOUPON" })).usedCount).toBe(1);

    // Cancel session
    const cancelRes = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Doi y khong mua nua" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.state).toBe("cancelled");

    // Coupon released
    expect((await Coupon.findOne({ code: "CANCELCOUPON" })).usedCount).toBe(0);

    // Cannot cancel again
    const cancelAgain = await request(app)
      .post(`/api/checkout/sessions/${paymentCode}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Huy tiep" });
    expect(cancelAgain.status).toBe(409);
  });

  test("3. Hết hạn session: cron job hoặc lazy-expire chuyển trạng thái expired và nhả coupon", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCoupon({ code: "TIMECOUPON", discount: 15 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const createRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString(), couponCode: "TIMECOUPON" });

    const { paymentCode, sessionId } = createRes.body.data;
    expect((await Coupon.findOne({ code: "TIMECOUPON" })).usedCount).toBe(1);

    // Trigger expireCheckout scheduler
    await expireCheckout(paymentCode, new Date(Date.now() + 86400000));

    // Polling session status shows expired
    const getRes = await request(app)
      .get(`/api/checkout/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.state).toBe("expired");

    // Coupon usedCount restored to 0
    expect((await Coupon.findOne({ code: "TIMECOUPON" })).usedCount).toBe(0);
  });

  test("4. Webhook đúng: tạo Order thật, trừ kho nguyên tử, đánh dấu session paid, xoá giỏ và bắn SSE", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 70000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const sessionRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    const { paymentCode, totalAmount } = sessionRes.body.data;

    // Send valid SePay webhook
    const webhookRes = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(
        webhookPayload({
          paymentCode,
          amount: totalAmount,
          referenceCode: "SEPAY-SUCCESS-REF-1",
        }),
      );

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.success).toBe(true);

    // 1. Order is created with paymentStatus = paid and status = processing
    const order = await Order.findOne({ paymentCode });
    expect(order).not.toBeNull();
    expect(order.paymentStatus).toBe("paid");
    expect(order.status).toBe("processing");
    expect(order.stockDeducted).toBe(true);
    expect(order.totalAmount).toBe(totalAmount);

    // 2. Stock is deducted atomically
    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(3);

    // 3. Checkout session is marked paid
    const checkout = await Checkout.findOne({ paymentCode });
    expect(checkout.state).toBe("paid");
    expect(checkout.paidReferenceCode).toBe("SEPAY-SUCCESS-REF-1");

    // 4. Cart is deleted
    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart).toBeNull();

    // 5. SSE notification outbox is enqueued for merchant
    const outbox = await NotificationOutbox.findOne({ orderId: order._id, type: "payment_received" });
    expect(outbox).not.toBeNull();
  });

  test("5. Webhook trùng: nhận 2 lần không tạo 2 đơn và không trừ kho 2 lần (idempotent)", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 10 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const sessionRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    const { paymentCode, totalAmount } = sessionRes.body.data;
    const payload = webhookPayload({
      paymentCode,
      amount: totalAmount,
      referenceCode: "SEPAY-DUP-REF-100",
    });

    // 1st delivery
    const res1 = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(payload);
    expect(res1.status).toBe(200);

    // 2nd delivery with identical referenceCode & payload
    const res2 = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.message).toMatch(/already processed/i);

    // Exactly 1 Order created
    const orders = await Order.find({ paymentCode });
    expect(orders).toHaveLength(1);

    // Stock deducted only once: 10 - 1 = 9
    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(9);
  });

  test("6. Sai tiền: chuyển thiếu tiền không tạo đơn, không trừ kho, đưa vào đối soát", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const sessionRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    const { paymentCode, totalAmount } = sessionRes.body.data;

    // Send underpaid webhook (transferred 60,000 instead of 100,000)
    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(
        webhookPayload({
          paymentCode,
          amount: totalAmount - 40000,
          referenceCode: "SEPAY-UNDERPAY-1",
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.remainingAmount).toBe(40000);

    // NO order is created
    const order = await Order.findOne({ paymentCode });
    expect(order).toBeNull();

    // Stock is untouched
    const freshProduct = await Product.findById(product._id);
    expect(freshProduct.stock).toBe(5);

    // Checkout remains pending with receivedAmount = 60000
    const checkout = await Checkout.findOne({ paymentCode });
    expect(checkout.state).toBe("pending");
    expect(checkout.receivedAmount).toBe(60000);
  });

  test("7. Hết hạn trước khi nhận webhook: không tạo đơn, đưa vào danh sách hoàn tiền", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 100000, stock: 5 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);

    const sessionRes = await request(app)
      .post("/api/checkout/sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ addressId: user.addresses[0]._id.toString() });

    const { paymentCode, totalAmount } = sessionRes.body.data;

    // Simulate session expired
    await Checkout.updateOne({ paymentCode }, { $set: { expiresAt: new Date(Date.now() - 60000) } });

    const res = await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send(
        webhookPayload({
          paymentCode,
          amount: totalAmount,
          referenceCode: "SEPAY-LATE-RECEIPT",
        }),
      );

    expect(res.status).toBe(200);

    // NO order is created
    const order = await Order.findOne({ paymentCode });
    expect(order).toBeNull();

    // Receipt is queued for refund in ReceiptRefund
    const refund = await ReceiptRefund.findOne({ amount: totalAmount, purpose: "receipt" });
    expect(refund).not.toBeNull();
    expect(refund.status).toBe("pending");
  });

  test("8. COD không đổi: tạo Order ngay, trừ kho ngay, dọn giỏ ngay, bắn SSE new_order ngay", async () => {
    const { user } = await createUser();
    const token = signToken(user);
    const brand = await createBrand();
    const product = await createProduct(brand, { price: 50000, stock: 8 });
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 2 }]);

    const res = await request(app)
      .post("/api/checkout/check-out")
      .set("Authorization", `Bearer ${token}`)
      .send({
        addressId: user.addresses[0]._id.toString(),
        paymentMethod: "cod",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const { orderCode } = res.body.data;

    // Order created immediately
    const order = await Order.findOne({ paymentCode: orderCode });
    expect(order).not.toBeNull();
    expect(order.paymentMethod).toBe("cod");
    expect(order.paymentStatus).toBe("pending");
    expect(order.status).toBe("pending");
    expect(order.stockDeducted).toBe(true);

    // Stock deducted immediately: 8 - 2 = 6
    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct.stock).toBe(6);

    // Cart cleared immediately
    const cart = await Cart.findOne({ userId: user._id, isSubscribeCart: false });
    expect(cart).toBeNull();

    // Outbox enqueued new_order
    const outbox = await NotificationOutbox.findOne({ orderId: order._id, type: "new_order" });
    expect(outbox).not.toBeNull();
  });
});
