// Test middleware rate limiter trên một app Express riêng, KHÔNG dùng chung
// app.js với các file test khác — vì bộ đếm của express-rate-limit là in-memory
// theo IP/app instance, nếu dùng chung app thật thì số lượt gọi ở các file test
// khác (checkout.test.js, webhook.test.js, security.test.js) sẽ cộng dồn vào
// cùng bộ đếm và làm test bị lệch/flaky.
const express = require("express");
const request = require("supertest");
const rateLimit = require("express-rate-limit");

function buildTestApp(max) {
  const app = express();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests" },
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json(options.message);
    },
  });
  app.use(limiter);
  app.get("/ping", (req, res) => res.json({ ok: true }));
  return app;
}

describe("rate limiter behavior (same config shape as src/middleware/rateLimiter.js)", () => {
  test("allows requests under the limit and blocks once the limit is exceeded", async () => {
    const app = buildTestApp(3);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/ping");
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
  });

  test("the real rateLimiter module exports callable middleware for auth/checkout/webhook", () => {
    const { authLimiter, checkoutLimiter, webhookLimiter } = require("../src/middleware/rateLimiter");
    expect(typeof authLimiter).toBe("function");
    expect(typeof checkoutLimiter).toBe("function");
    expect(typeof webhookLimiter).toBe("function");
  });
});
