const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, message);
  } else {
    logger.warn({ path: req.originalUrl, method: req.method }, message);
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Validation Error",
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Duplicate field value entered",
    });
  }

  if (
    err.name === "MulterError" ||
    /^Chỉ chấp nhận file ảnh/.test(err.message || "")
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: err.message,
    });
  }

  if (err.name === "VersionError") return res.status(409).json({ success: false, message: "Dữ liệu vừa được thay đổi. Vui lòng tải lại." });
  if (err.name === "CastError") return res.status(400).json({ success: false, message: "ID không hợp lệ" });
  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      status: 401,
      message: "Invalid token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      status: 401,
      message: "Token has expired",
    });
  }

  res.status(status).json({
    success: false,
    status,
    message: status >= 500 && process.env.NODE_ENV === "production" ? "Lỗi hệ thống. Vui lòng thử lại." : message,
    requestId: req.id,
  });
};

module.exports = errorHandler;
