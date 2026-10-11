// Đăng ký, mật khẩu tối thiểu 8 ký tự, lỗi an toàn, và token đặt lại mật khẩu trong body.
const request = require("supertest");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const app = require("../src/app");
const User = require("../src/models/User");
const { connect, clearDatabase, closeDatabase } = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(async () => {
  await connect();
  await User.init(); // đảm bảo index unique của email đã được tạo
});
afterEach(async () => {
  await clearDatabase();
  await User.init();
});
afterAll(async () => {
  await closeDatabase();
});

const register = (body) => request(app).post("/api/users/register").send(body);

describe("đăng ký", () => {
  test("mật khẩu 8 ký tự được chấp nhận, không trả về mật khẩu", async () => {
    const res = await register({ name: "Nguoi Dung", email: "a@test.com", password: "Abcdef12" });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("Abcdef12");
    expect(res.body.data.password).toBeUndefined();
  });

  test("mật khẩu dưới 8 ký tự bị từ chối", async () => {
    const res = await register({ name: "Nguoi Dung", email: "b@test.com", password: "Abcde12" });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ email: "b@test.com" })).toBe(0);
  });

  test("email đã tồn tại: 409 với thông báo an toàn, không lộ lỗi cơ sở dữ liệu", async () => {
    await register({ name: "Nguoi Dung", email: "c@test.com", password: "Abcdef12" });
    const dup = await register({ name: "Nguoi Khac", email: "c@test.com", password: "Abcdef12" });
    expect(dup.status).toBe(409);
    expect(dup.body.success).toBe(false);
    const text = JSON.stringify(dup.body);
    expect(text).not.toMatch(/E11000|dup key|index|mongo/i);
  });
});

describe("đặt lại mật khẩu", () => {
  async function userWithResetToken() {
    const { user } = await createUser();
    const token = crypto.randomBytes(20).toString("hex");
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: crypto.createHash("sha256").update(token).digest("hex"),
          resetPasswordExpires: Date.now() + 10 * 60 * 1000,
        },
      },
    );
    return { user, token };
  }

  test("token trong body hoạt động và mật khẩu mới được lưu", async () => {
    const { user, token } = await userWithResetToken();
    const res = await request(app)
      .post("/api/home/reset-password")
      .send({ token, password: "NewPassword123!" });
    expect(res.status).toBe(200);
    const saved = await User.findById(user._id);
    expect(await bcrypt.compare("NewPassword123!", saved.password)).toBe(true);
  });

  test("token trong query vẫn hoạt động (tương thích ngược)", async () => {
    const { user, token } = await userWithResetToken();
    const res = await request(app)
      .post(`/api/home/reset-password?token=${token}`)
      .send({ password: "NewPassword123!" });
    expect(res.status).toBe(200);
    expect(await bcrypt.compare("NewPassword123!", (await User.findById(user._id)).password)).toBe(true);
  });

  test("token sai định dạng hoặc mật khẩu dưới 8 ký tự bị 400", async () => {
    const { token } = await userWithResetToken();
    const badToken = await request(app)
      .post("/api/home/reset-password")
      .send({ token: "not-a-token", password: "NewPassword123!" });
    expect(badToken.status).toBe(400);
    const shortPassword = await request(app)
      .post("/api/home/reset-password")
      .send({ token, password: "Abcde12" });
    expect(shortPassword.status).toBe(400);
  });

  test("token đã dùng không dùng lại được", async () => {
    const { token } = await userWithResetToken();
    const first = await request(app).post("/api/home/reset-password").send({ token, password: "NewPassword123!" });
    const second = await request(app).post("/api/home/reset-password").send({ token, password: "AnotherPass123!" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });
});
