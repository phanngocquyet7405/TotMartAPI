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

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function placeOrder(user, token, paymentMethod, overrides = {}) {
  const brand = overrides.brand || (await createBrand());
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
    .send({ addressId: user.addresses[0]._id.toString(), paymentMethod });

  const order = await Order.findOne({ orderId: res.body.data.orders[0] });
  return { checkoutRes: res, order };
}

// ─── GET /api/admin/orders ──────────────────────────────────────────────────

describe("GET /api/admin/orders", () => {
  test("rejects a call with no auth token", async () => {
    const res = await request(app).get("/api/admin/orders");
    expect(res.status).toBe(401);
  });

  test("rejects a non-admin user", async () => {
    const { user } = await createUser();
    const res = await request(app)
      .get("/api/admin/orders")
      .set("Authorization", `Bearer ${signToken(user)}`);
    expect(res.status).toBe(403);
  });

  test("an admin lists orders across all users, newest first", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    await placeOrder(user, signToken(user), "cod");
    await placeOrder(user, signToken(user), "online");

    const res = await request(app)
      .get("/api/admin/orders")
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  test("filters by status", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    await placeOrder(user, signToken(user), "cod");
    await placeOrder(user, signToken(user), "online");

    const res = await request(app)
      .get("/api/admin/orders?status=pending")
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((o) => o.status === "pending")).toBe(true);
  });

  test("filters by paymentMethod", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    await placeOrder(user, signToken(user), "cod");
    await placeOrder(user, signToken(user), "online");

    const res = await request(app)
      .get("/api/admin/orders?paymentMethod=online")
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].paymentMethod).toBe("online");
  });

  test("searches by orderId", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    const res = await request(app)
      .get(`/api/admin/orders?search=${order.orderId}`)
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].orderId).toBe(order.orderId);
  });

  test("respects page/limit and reports totalPages", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    await placeOrder(user, signToken(user), "cod");
    await placeOrder(user, signToken(user), "cod");
    await placeOrder(user, signToken(user), "cod");

    const res = await request(app)
      .get("/api/admin/orders?page=1&limit=2")
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });
});

// ─── GET /api/admin/orders/:_id ──────────────────────────────────────────────

describe("GET /api/admin/orders/:_id", () => {
  test("an admin can view order detail", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    const res = await request(app)
      .get(`/api/admin/orders/${order._id}`)
      .set("Authorization", `Bearer ${signToken(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orderId).toBe(order.orderId);
  });

  test("returns 404 for a well-formed id that doesn't exist", async () => {
    const { user: admin } = await createUser({ role: "admin" });
    const res = await request(app)
      .get("/api/admin/orders/507f1f77bcf86cd799439011")
      .set("Authorization", `Bearer ${signToken(admin)}`);
    expect(res.status).toBe(404);
  });

  test("rejects a malformed id", async () => {
    const { user: admin } = await createUser({ role: "admin" });
    const res = await request(app)
      .get("/api/admin/orders/not-an-object-id")
      .set("Authorization", `Bearer ${signToken(admin)}`);
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/admin/orders/:_id/status ─────────────────────────────────────

describe("POST /api/admin/orders/:_id/status", () => {
  test("rejects a non-admin user", async () => {
    const { user } = await createUser();
    const { order } = await placeOrder(user, signToken(user), "cod");

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(user)}`)
      .send({ status: "shipped" });

    expect(res.status).toBe(403);
  });

  test("rejects a status value outside the generic-safe list", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "cancelled" });

    // "cancelled" không nằm trong orderStatusUpdateSchema — phải huỷ qua
    // /checkout/cancel/:_id (có hoàn kho/hoàn coupon), không phải ở đây.
    expect(res.status).toBe(400);
  });

  test("rejects an out-of-order transition (pending -> shipped)", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");
    expect(order.status).toBe("pending");

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "shipped" });

    expect(res.status).toBe(400);
  });

  test("processing -> shipped succeeds and is recorded in statusHistory", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    await request(app)
      .post(`/api/checkout/confirm-cod/${order._id}`)
      .set("Authorization", `Bearer ${signToken(admin)}`);

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "shipped" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("shipped");

    const updated = await Order.findById(order._id);
    expect(updated.status).toBe("shipped");
    expect(
      updated.statusHistory.some((h) => h.status === "shipped"),
    ).toBe(true);
  });

  test("shipped -> delivered succeeds for an ONLINE order", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "online");

    // pending -> processing tự động qua webhook khi thanh toán xong.
    await request(app)
      .post("/api/checkout/sepay-webhook")
      .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
      .send({
        id: 1,
        gateway: "TestBank",
        transactionDate: new Date().toISOString(),
        accountNumber: process.env.SEPAY_BANK_ACCOUNT,
        content: `Chuyen khoan ${order.paymentCode}`,
        code: order.paymentCode,
        transferType: "in",
        transferAmount: order.totalAmount,
        referenceCode: "REF-ADMIN-DELIVER-1",
      });

    await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "shipped" });

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "delivered" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("delivered");
    expect(res.body.data.paymentStatus).toBe("paid");
  });

  test("shipped -> delivered is REJECTED for a COD order (must use mark-cod-delivered instead)", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    await request(app)
      .post(`/api/checkout/confirm-cod/${order._id}`)
      .set("Authorization", `Bearer ${signToken(admin)}`);
    await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "shipped" });

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "delivered" });

    expect(res.status).toBe(400);

    const unchanged = await Order.findById(order._id);
    expect(unchanged.status).toBe("shipped");
    expect(unchanged.paymentStatus).toBe("pending");
  });

  test("on_hold -> processing succeeds", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const { order } = await placeOrder(user, signToken(user), "cod");

    // Kịch bản on_hold thật (hết hàng lúc webhook xử lý) đã có sẵn logic
    // riêng ở checkOutController; ở đây chỉ cần dựng ĐÚNG trạng thái đầu vào
    // để test transition của orderAdminController, không lặp lại toàn bộ
    // luồng dẫn tới on_hold.
    order.status = "on_hold";
    await order.save();

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "processing" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("processing");
  });

  test("returns 404 for a well-formed id that doesn't exist", async () => {
    const { user: admin } = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/api/admin/orders/507f1f77bcf86cd799439011/status")
      .set("Authorization", `Bearer ${signToken(admin)}`)
      .send({ status: "shipped" });
    expect(res.status).toBe(404);
  });
});
