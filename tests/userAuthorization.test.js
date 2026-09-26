// Exercise real routes, validation, controllers, and JWT verification.
// Persistence is mocked so these regressions run without a MongoDB process.
jest.mock("../src/models/User", () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOne: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const User = require("../src/models/User");
const config = require("../src/config/environment");
const middleware = require("../src/middleware/authMiddleware");
const authController = require("../src/controllers/authController");
const app = express();
app.use(express.json());
app.use("/users", require("../src/routes/userRouter"));
app.get("/admin-only", middleware.adminMiddleware, (req, res) => res.json({ success: true }));
app.post("/login", authController.login);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));

const actorId = "507f1f77bcf86cd799439011";
const targetId = "507f1f77bcf86cd799439012";
const addressId = "507f1f77bcf86cd799439013";
let actor;
let target;
let passwordHash;
beforeAll(async () => { passwordHash = await bcrypt.hash("Password123!", 4); });
beforeEach(() => {
  jest.resetAllMocks();
  const fixture = (_id) => ({
    _id, role: "user", isActive: true, tokenVersion: 0,
    name: "Test User", email: "test@example.com", password: passwordHash,
    refreshToken: [], addresses: [{ _id: addressId, address: "Original address" }],
    save: jest.fn().mockResolvedValue(undefined),
  });
  actor = fixture(actorId);
  target = fixture(targetId);
  User.findById.mockImplementation(async (id) => String(id).toLowerCase() === actorId ? actor : target);
  User.findByIdAndUpdate.mockResolvedValue(target);
  User.findOne.mockResolvedValue(actor);
});

function authorization(claims = {}) {
  return `Bearer ${jwt.sign({ userId: actorId, role: actor.role, tokenVersion: 0, ...claims }, config.jwt.secret, { expiresIn: "1h" })}`;
}
const routes = [
  ["get", (id) => `/users/get-user-by-id/${id}`, {}],
  ["put", (id) => `/users/update-user/${id}`, { name: "Updated Name" }],
  ["post", (id) => `/users/update-address/${id}`, { address: "Updated address" }],
  ["put", (id) => `/users/edit-address/${id}/${addressId}`, { address: "Updated address" }],
  ["delete", (id) => `/users/delete-address/${id}/${addressId}`, {}],
];

describe.each(routes)("%s protected user route", (method, path, body) => {
  test("rejects another user before reading or modifying their record", async () => {
    const response = await request(app)[method](path(targetId)).set("Authorization", authorization()).send(body);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Access denied" });
    expect(User.findById).toHaveBeenCalledTimes(1);
    expect(User.findById).toHaveBeenCalledWith(actorId);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(target.save).not.toHaveBeenCalled();
    expect(target.addresses[0].address).toBe("Original address");
  });
  test("allows the owner", async () => {
    const response = await request(app)[method](path(actorId)).set("Authorization", authorization()).send(body);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
  test("allows a current active admin", async () => {
    actor.role = "admin";
    const response = await request(app)[method](path(targetId)).set("Authorization", authorization()).send(body);
    expect(response.status).toBe(200);
  });
  test("rejects unauthenticated access", async () => {
    expect((await request(app)[method](path(targetId)).send(body)).status).toBe(401);
    expect(User.findById).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
  test("rejects a stale admin claim", async () => {
    const response = await request(app)[method](path(targetId)).set("Authorization", authorization({ role: "admin" })).send(body);
    expect(response.status).toBe(403);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(target.save).not.toHaveBeenCalled();
  });
});

test("accepts an uppercase owner ObjectId", async () => {
  expect((await request(app).get(`/users/get-user-by-id/${actorId.toUpperCase()}`).set("Authorization", authorization())).status).toBe(200);
});

test("retains the update whitelist for owners", async () => {
  const response = await request(app).put(`/users/update-user/${actorId}`)
    .set("Authorization", authorization())
    .send({ name: "Updated Name", role: "admin", password: "changed", isActive: false });
  expect(response.status).toBe(200);
  const update = User.findByIdAndUpdate.mock.calls[0][1];
  expect(update.name).toBe("Updated Name");
  for (const key of ["role", "password", "isActive"]) expect(update).not.toHaveProperty(key);
});

test.each(["user", "admin"])("locked %s cannot access normal routes or log in", async (role) => {
  actor.role = role;
  actor.isActive = false;
  expect((await request(app).get(`/users/get-user-by-id/${actorId}`).set("Authorization", authorization())).status).toBe(403);
  const response = await request(app).post("/login").send({ email: actor.email, password: "Password123!" });
  expect(response.status).toBe(403);
  expect(response.body.success).toBe(false);
  expect(response.body).not.toHaveProperty("token");
  expect(response.body).not.toHaveProperty("refreshToken");
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(actor.refreshToken).toEqual([]);
  expect(actor.save).not.toHaveBeenCalled();
});

test.each([
  ["admin", true, "admin", 200],
  ["admin", false, "admin", 403],
  ["user", true, "admin", 403],
  ["user", true, "user", 403],
])("standalone admin guard: database role %s, active %s, JWT role %s", async (role, active, claim, status) => {
  actor.role = role;
  actor.isActive = active;
  expect((await request(app).get("/admin-only").set("Authorization", authorization({ role: claim }))).status).toBe(status);
});

test("revoked tokens cannot access either guard", async () => {
  actor.role = "admin";
  actor.tokenVersion = 1;
  for (const path of ["/admin-only", `/users/get-user-by-id/${actorId}`]) {
    expect((await request(app).get(path).set("Authorization", authorization())).status).toBe(401);
  }
});

test("active accounts can still log in", async () => {
  const response = await request(app).post("/login").send({ email: actor.email, password: "Password123!" });
  expect(response.status).toBe(200);
  expect(response.body.token).toEqual(expect.any(String));
  expect(response.headers["set-cookie"]).toHaveLength(2);
  expect(actor.save).toHaveBeenCalledTimes(1);
});

test("locked accounts with incorrect passwords retain the invalid-password response", async () => {
  actor.isActive = false;
  const response = await request(app).post("/login").send({ email: actor.email, password: "WrongPassword" });
  expect(response.status).toBe(401);
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(actor.save).not.toHaveBeenCalled();
});
