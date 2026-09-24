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
    message,
  });
};

module.exports = errorHandler;
