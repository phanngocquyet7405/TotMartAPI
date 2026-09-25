jest.mock("../src/utils/sendEmail", () => jest.fn());
const request = require("supertest");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const app = require("../src/app");
const sendEmail = require("../src/utils/sendEmail");
const User = require("../src/models/User");
const Order = require("../src/models/Order");
const Notification = require("../src/models/Notification");
const { consumeSseTicket } = require("../src/utils/notify");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const { createUser, signToken } = require("./helpers/factories");

beforeAll(connect);
afterEach(async () => { await clearDatabase(); jest.clearAllMocks(); });
afterAll(closeDatabase);

async function resetToken(user, expired = false) {
  const token = crypto.randomBytes(20).toString("hex");
  await User.updateOne({ _id: user._id }, { $set: {
    resetPasswordToken: crypto.createHash("sha256").update(token).digest("hex"),
    resetPasswordExpires: new Date(Date.now() + (expired ? -1000 : 600000)),
    refreshToken: ["old-session"],
  } });
  return token;
}

describe("password recovery", () => {
  test("sends a frontend link without revealing whether an email exists", async () => {
    const { user } = await createUser();
    sendEmail.mockResolvedValue({ success: true });
    const known = await request(app).post("/api/home/forgot-password").send({ email: user.email });
    const unknown = await request(app).post("/api/home/forgot-password").send({ email: "absent@example.com" });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    const html = sendEmail.mock.calls[0][2];
    const token = html.match(/reset-password\?token=([a-f0-9]{40})/)[1];
    const saved = await User.findById(user._id);
    expect(saved.resetPasswordToken).toBe(crypto.createHash("sha256").update(token).digest("hex"));
  });

  test("email failure clears the unusable reset token", async () => {
    const { user } = await createUser();
    sendEmail.mockResolvedValue({ success: false, error: "provider failure" });
    const res = await request(app).post("/api/home/forgot-password").send({ email: user.email });
    expect(res.status).toBe(500);
    expect((await User.findById(user._id)).resetPasswordToken).toBeUndefined();
  });

  test("reset is single-use and revokes old access and refresh sessions", async () => {
    const { user } = await createUser();
    const oldAccess = signToken(user);
    const token = await resetToken(user);
    const results = await Promise.all([1, 2].map(() => request(app)
      .post(`/api/home/reset-password?token=${token}`).send({ password: "NewPassword123!" })));
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    const saved = await User.findById(user._id);
    expect(await bcrypt.compare("NewPassword123!", saved.password)).toBe(true);
    expect(saved.refreshToken).toHaveLength(0);
    expect(saved.resetPasswordToken).toBeUndefined();
    expect((await request(app).get("/api/orders").set("Authorization", `Bearer ${oldAccess}`)).status).toBe(401);
    const login = await request(app).post("/api/home/login").send({ email: user.email, password: "NewPassword123!" });
    expect(login.status).toBe(200);
    expect((await request(app).get("/api/orders").set("Authorization", `Bearer ${login.body.token}`)).status).toBe(200);
  });

  test("rejects missing, malformed, expired tokens and short passwords", async () => {
    const { user } = await createUser();
    const token = await resetToken(user, true);
    for (const query of ["", "?token=bad", `?token=${token}`]) {
      expect((await request(app).post(`/api/home/reset-password${query}`).send({ password: "Password123!" })).status).toBe(400);
    }
    expect((await request(app).post(`/api/home/reset-password?token=${token}`).send({ password: "abc" })).status).toBe(400);
  });
});

describe("customer orders", () => {
  test("requires authentication and limits list/detail to the owner", async () => {
    const { user } = await createUser();
    const { user: other } = await createUser();
    const own = await Order.create({ userId: user._id, merchantId: other._id, orderId: "OWN", paymentCode: "TMARTOWN", totalAmount: 100 });
    const foreign = await Order.create({ userId: other._id, merchantId: other._id, orderId: "OTHER", paymentCode: "TMARTOTHER", totalAmount: 200 });
    const auth = `Bearer ${signToken(user)}`;
    expect((await request(app).get("/api/orders")).status).toBe(401);
    const list = await request(app).get(`/api/orders?userId=${other._id}&limit=1`).set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].orderId).toBe("OWN");
    expect(list.body.data[0].merchantId).toBeUndefined();
    expect((await request(app).get(`/api/orders/${foreign._id}`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).get(`/api/orders/${own._id}`).set("Authorization", auth)).status).toBe(200);
    expect((await request(app).get("/api/orders/invalid").set("Authorization", auth)).status).toBe(400);
    const empty = await request(app).get("/api/orders?page=2&limit=1").set("Authorization", auth);
    expect(empty.body.data).toHaveLength(0);
  });
});

describe("admin notifications", () => {
  test("issues one-use tickets only to admins and persists read state", async () => {
    const { user } = await createUser();
    const { user: admin } = await createUser({ role: "admin" });
    const auth = `Bearer ${signToken(admin)}`;
    const base = "/api/admin/notifications";
    expect((await request(app).get(`${base}/stream-ticket`).set("Authorization", `Bearer ${signToken(user)}`)).status).toBe(403);
    const ticket = await request(app).get(`${base}/stream-ticket`).set("Authorization", auth);
    expect(ticket.status).toBe(200);
    expect(String(consumeSseTicket(ticket.body.data.ticket))).toBe(String(admin._id));
    expect(consumeSseTicket(ticket.body.data.ticket)).toBeNull();
    expect((await request(app).get(`${base}/stream?token=invalid`)).status).toBe(401);
    const notification = await Notification.create({ type: "new_order", order: new (require("mongoose").Types.ObjectId)(), orderCode: "TM1", message: "New order" });
    const list = await request(app).get(base).set("Authorization", auth);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.data[0]._id).toBe(String(notification._id));
    expect((await request(app).patch(`${base}/${notification._id}/mark-read`).set("Authorization", auth)).status).toBe(200);
    expect((await request(app).get(base).set("Authorization", auth)).body.unreadCount).toBe(0);
  });
});
