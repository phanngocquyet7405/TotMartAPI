const rateLimit = require("express-rate-limit");

function buildLimiter({ windowMs, max, message, policy }) {
  return rateLimit({
    windowMs,
    max,
    ...(require("../config/redis").enabled() ? {store:new (require("../services/redisRateLimitStore").RedisRateLimitStore)(policy)} : {}),
    standardHeaders: true, // trả RateLimit-* headers
    legacyHeaders: false, // tắt X-RateLimit-* cũ
    message: { success: false, message },
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json(options.message);
    },
  });
}

const authLimiter = buildLimiter({
  policy: "auth",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Quá nhiều yêu cầu đăng nhập/đăng ký, vui lòng thử lại sau ít phút",
});

const checkoutLimiter = buildLimiter({
  policy: "checkout",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều yêu cầu đặt hàng, vui lòng thử lại sau ít phút",
});

const webhookLimiter = buildLimiter({
  policy: "webhook",
  windowMs: 60 * 1000, // 1 phút
  max: 60,
  message: "Too many webhook requests",
});

const refreshLimiter = buildLimiter({
  policy: "refresh",
  windowMs: 60 * 1000,
  max: 120,
  message: "Quá nhiều yêu cầu làm mới phiên, vui lòng thử lại sau ít phút",
});
const ticketLimiter = buildLimiter({ policy: "ticket", windowMs: 60000, max: 30, message: "Too many stream ticket requests" });
module.exports = {
  ticketLimiter,
  authLimiter,
  refreshLimiter,
  checkoutLimiter,
  webhookLimiter,
};
