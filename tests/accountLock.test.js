// Khóa tài khoản phải thu hồi toàn bộ truy cập đang có và không "sống lại" khi mở khóa.
const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const AuthSession = require("../src/models/AuthSession");
const notificationController = require("../src/controllers/notificationController");
const { connect, clearDatabase, closeDatabase } = require("./helpers/db");
const { createUser, signToken } = require("./helpers/factories");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function setup() {
  const { user: admin } = await createUser({ role: "admin" });
  const { user: target, plainPassword } = await createUser();
  await User.updateOne({ _id: target._id }, { $set: { refreshToken: ["old-refresh"] } });
  await AuthSession.create({
    sessionId: `session-${target._id}`,
    userId: target._id,
    refreshHash: `hash-${target._id}`,
    tokenVersion: 0,
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return { adminToken: signToken(admin), target, targetToken: signToken(target), plainPassword };
}

test("khóa tài khoản: tăng tokenVersion, xóa phiên làm mới và đóng luồng SSE", async () => {
  const { adminToken, target } = await setup();
  const terminate = jest.spyOn(notificationController, "terminateUserStreams");

  const res = await request(app).delete(`/api/users/lock-user/${target._id}`).set(bearer(adminToken));
  expect(res.status).toBe(200);

  const saved = await User.findById(target._id);
  expect(saved.isActive).toBe(false);
  expect(saved.tokenVersion).toBe(1);
  expect(saved.refreshToken).toEqual([]);
  expect(await AuthSession.countDocuments({ userId: target._id })).toBe(0);
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(String(terminate.mock.calls[0][0])).toBe(String(target._id));
});

test("token cấp trước khi khóa không dùng lại được kể cả sau khi mở khóa", async () => {
  const { adminToken, target, targetToken } = await setup();

  expect((await request(app).get("/api/users/me").set(bearer(targetToken))).status).toBe(200);

  await request(app).delete(`/api/users/lock-user/${target._id}`).set(bearer(adminToken));
  expect((await request(app).get("/api/users/me").set(bearer(targetToken))).status).not.toBe(200);

  const unlock = await request(app).patch(`/api/users/unlock-user/${target._id}`).set(bearer(adminToken));
  expect(unlock.status).toBe(200);
  expect((await User.findById(target._id)).isActive).toBe(true);

  const stale = await request(app).get("/api/users/me").set(bearer(targetToken));
  expect(stale.status).toBe(401);
});

test("sau khi mở khóa, người dùng đăng nhập lại bình thường", async () => {
  const { adminToken, target, plainPassword } = await setup();
  await request(app).delete(`/api/users/lock-user/${target._id}`).set(bearer(adminToken));
  await request(app).patch(`/api/users/unlock-user/${target._id}`).set(bearer(adminToken));

  const login = await request(app)
    .post("/api/home/login")
    .send({ email: target.email, password: plainPassword });
  expect(login.status).toBe(200);
});

test("khóa người dùng không tồn tại trả 404, không đóng luồng của ai", async () => {
  const { adminToken } = await setup();
  const terminate = jest.spyOn(notificationController, "terminateUserStreams");
  const res = await request(app)
    .delete("/api/users/lock-user/507f1f77bcf86cd799439011")
    .set(bearer(adminToken));
  expect(res.status).toBe(404);
  expect(terminate).not.toHaveBeenCalled();
});

test("người dùng thường không khóa được ai", async () => {
  const { target } = await setup();
  const { user: other } = await createUser();
  const res = await request(app)
    .delete(`/api/users/lock-user/${target._id}`)
    .set(bearer(signToken(other)));
  expect([401, 403]).toContain(res.status);
  expect((await User.findById(target._id)).isActive).toBe(true);
});
