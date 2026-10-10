// Kiểm tra hành vi CORS: origin hợp lệ qua, origin lạ bị 403 (không phải 500).
process.env.CORS_ORIGINS =
  "https://tot-mart.vercel.app/, https://admin.totmart.example";

const request = require("supertest");
const app = require("../src/app");

const ALLOWED = "https://tot-mart.vercel.app";
const OTHER_ALLOWED = "https://admin.totmart.example";
const DENIED = "https://evil.example";

describe("CORS", () => {
  test("origin hợp lệ được phép (cấu hình có dấu / cuối vẫn khớp)", async () => {
    const res = await request(app).get("/api/home/health").set("Origin", ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("origin hợp lệ thứ hai trong danh sách cũng được phép", async () => {
    const res = await request(app)
      .get("/api/home/health")
      .set("Origin", OTHER_ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(OTHER_ALLOWED);
  });

  test("origin lạ bị 403, không có header CORS, không in lại origin", async () => {
    const res = await request(app).get("/api/home/health").set("Origin", DENIED);
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(DENIED);
  });

  test("origin chỉ khác giao thức hoặc có hậu tố vẫn bị từ chối", async () => {
    for (const origin of [
      "http://tot-mart.vercel.app",
      "https://tot-mart.vercel.app.evil.example",
    ]) {
      const res = await request(app).get("/api/home/health").set("Origin", origin);
      expect(res.status).toBe(403);
    }
  });

  test("không có Origin (gọi từ máy chủ, curl, SePay) vẫn qua", async () => {
    const res = await request(app).get("/api/home/health");
    expect(res.status).toBe(200);
  });

  test("preflight từ origin hợp lệ trả 204, từ origin lạ trả 403", async () => {
    const ok = await request(app)
      .options("/api/home/login")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST");
    expect(ok.status).toBe(204);
    const bad = await request(app)
      .options("/api/home/login")
      .set("Origin", DENIED)
      .set("Access-Control-Request-Method", "POST");
    expect(bad.status).toBe(403);
  });
});
