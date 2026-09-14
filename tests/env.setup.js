// Chạy TRƯỚC khi bất kỳ file test hoặc module app nào được require (xem
// jest.config.js -> setupFiles). Đặt sẵn các biến môi trường bắt buộc để
// src/config/environment.js không throw khi bị import trong lúc test.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
process.env.JWT_REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRES_IN || "1d";
process.env.SEPAY_API_KEY = process.env.SEPAY_API_KEY || "test-sepay-key";
process.env.SEPAY_BANK_ACCOUNT = process.env.SEPAY_BANK_ACCOUNT || "0123456789";
process.env.SEPAY_BANK_NAME = process.env.SEPAY_BANK_NAME || "TestBank";
process.env.ORDER_EXPIRY_HOURS = process.env.ORDER_EXPIRY_HOURS || "24";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";
process.env.CORS_ORIGINS =
  process.env.CORS_ORIGINS || "http://localhost:3001";
