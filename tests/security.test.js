
const request = require("supertest");
const app = require("../src/app");

describe("Security hardening", () => {
  describe("Helmet security headers", () => {
    test("adds standard security headers and removes X-Powered-By", async () => {
      const res = await request(app).get("/api/home/health");
      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });

  describe("CORS allowlist", () => {
    test("allows a request with no Origin header (server-to-server / webhook)", async () => {
      const res = await request(app).get("/api/home/health");
      expect(res.status).toBe(200);
    });

    test("rejects a request from an origin not in CORS_ORIGINS", async () => {
      const res = await request(app)
        .get("/api/home/health")
        .set("Origin", "https://evil-site.example");
      expect(res.status).toBe(500);
    });

    test("allows a request from an origin in CORS_ORIGINS", async () => {
      const res = await request(app)
        .get("/api/home/health")
        .set("Origin", process.env.CORS_ORIGINS.split(",")[0]);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        process.env.CORS_ORIGINS.split(",")[0],
      );
    });
  });

  describe("Auth guard on protected routes", () => {
    test("checkout without a token is rejected before touching the database", async () => {
      const res = await request(app).post("/api/checkout/check-out").send({
        addressId: "507f1f77bcf86cd799439011",
        paymentMethod: "cod",
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test("admin-only routes reject a request with no token", async () => {
      const res = await request(app).get("/api/users/get-all-users");
      expect(res.status).toBe(401);
    });
  });

  describe("SePay webhook API-key auth", () => {
    const validPayload = {
      id: 1,
      gateway: "TestBank",
      transactionDate: new Date().toISOString(),
      accountNumber: "0123456789",
      content: "test",
      transferType: "in",
      transferAmount: 100000,
      referenceCode: "REF-SECURITY-TEST",
    };

    test("rejects a webhook call with no Authorization header", async () => {
      const res = await request(app)
        .post("/api/checkout/sepay-webhook")
        .send(validPayload);
      expect(res.status).toBe(401);
    });

    test("rejects a webhook call with the wrong API key", async () => {
      const res = await request(app)
        .post("/api/checkout/sepay-webhook")
        .set("Authorization", "Apikey wrong-key")
        .send(validPayload);
      expect(res.status).toBe(401);
    });

    test("accepts the API key header format (passes auth, may still fail later validation without DB)", async () => {
      const res = await request(app)
        .post("/api/checkout/sepay-webhook")
        .set("Authorization", `Apikey ${process.env.SEPAY_API_KEY}`)
        .send(validPayload);
      // Không có DB nên có thể lỗi ở bước xử lý đơn hàng, nhưng chắc chắn
      // KHÔNG được là 401 — nghĩa là bước xác thực API key đã pass.
      expect(res.status).not.toBe(401);
    });
  });

  describe("Unknown routes", () => {
    test("returns a 404 JSON payload for an unregistered route", async () => {
      const res = await request(app).get("/api/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
