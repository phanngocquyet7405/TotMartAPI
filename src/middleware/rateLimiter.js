const rateLimit = require("express-rate-limit");

// Trả JSON đồng nhất với format lỗi chung của hệ thống (success/message)
// thay vì text mặc định của express-rate-limit.
function buildLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // trả RateLimit-* headers
    legacyHeaders: false, // tắt X-RateLimit-* cũ
    message: { success: false, message },
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json(options.message);
    },
  });
}

// ==== Auth: /login, /register, /forgot-password, /reset-password ====
// Chống brute-force dò mật khẩu và spam tạo tài khoản/reset password.
const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 10,
  message:
    "Quá nhiều yêu cầu đăng nhập/đăng ký, vui lòng thử lại sau ít phút",
});

// ==== Checkout: /check-out ====
// Chống spam tạo đơn hàng liên tục (vd. bot dò coupon hoặc làm nghẽn kho hàng).
const checkoutLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Quá nhiều yêu cầu đặt hàng, vui lòng thử lại sau ít phút",
});

// ==== Webhook SePay: /sepay-webhook ====
// Đã có xác thực API key riêng (sepayAuth) chống giả mạo nội dung; limiter ở đây
// chỉ để chặn DoS/brute-force dò API key. Ngưỡng cao vì SePay có thể gửi nhiều
// webhook hợp lệ liên tiếp khi có nhiều giao dịch xảy ra cùng lúc.
const webhookLimiter = buildLimiter({
  windowMs: 60 * 1000, // 1 phút
  max: 60,
  message: "Too many webhook requests",
});

module.exports = { authLimiter, checkoutLimiter, webhookLimiter };
