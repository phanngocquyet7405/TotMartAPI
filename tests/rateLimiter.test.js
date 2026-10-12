const express = require("express");
const request = require("supertest");
function createApp() {
  jest.resetModules();
  const login = jest.fn((req, res) => res.status(401).json({ success: false }));
  const refresh = jest.fn((req, res) =>
    res.status(401).json({ success: false }),
  );
  jest.doMock("../src/controllers/authController", () => ({
    login,
    refresh,
    logout: (req, res) => res.sendStatus(204),
    forgotPassword: (req, res) => res.sendStatus(204),
    resetPassword: (req, res) => res.sendStatus(204),
  }));
  const app = express();
  app.use(express.json());
  app.use("/api/home", require("../src/routes/homeRouter"));
  return { app, login, refresh };
}
const loginBody = { email: "quota@example.com", password: "invalid-password" };
const loginRequest = (app) =>
  request(app).post("/api/home/login").send(loginBody);
const refreshRequest = (app) => request(app).post("/api/home/refresh").send({});
describe("real auth routes: independent login/refresh quotas", () => {
  afterEach(() => jest.dontMock("../src/controllers/authController"));
  test("10 failed login attempts pass; attempt 11 blocks before controller", async () => {
    const { app, login } = createApp();
    for (let i = 0; i < 10; i++)
      expect((await loginRequest(app)).status).toBe(401);
    const blocked = await loginRequest(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(login).toHaveBeenCalledTimes(10);
  });
  test("exhausting login does not block refresh; recovery shares auth quota", async () => {
    const { app, refresh } = createApp();
    for (let i = 0; i < 10; i++) await loginRequest(app);
    expect((await loginRequest(app)).status).toBe(429);
    expect((await refreshRequest(app)).status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      (
        await request(app)
          .post("/api/home/forgot-password")
          .send({ email: loginBody.email })
      ).status,
    ).toBe(429);
  });
  test("120 refresh attempts pass; attempt 121 blocks; login remains usable", async () => {
    const { app, refresh, login } = createApp();
    for (let i = 0; i < 120; i++)
      expect((await refreshRequest(app)).status).toBe(401);
    const blocked = await refreshRequest(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalledTimes(120);
    expect((await loginRequest(app)).status).toBe(401);
    expect(login).toHaveBeenCalledTimes(1);
  });
});
