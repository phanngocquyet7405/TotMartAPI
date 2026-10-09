require("dotenv").config();

const config = {
  port: process.env.PORT || 3001,
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/totmart?replicaSet=rs0",
  },
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      "your-refresh-secret-change-in-production",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  sepay: {
    apiKey: process.env.SEPAY_API_KEY,
    bankAccount: process.env.SEPAY_BANK_ACCOUNT,
    bankName: process.env.SEPAY_BANK_NAME,
  },
  orderExpiryHours: Number(process.env.ORDER_EXPIRY_HOURS) || 24,
  nodeEnv: process.env.NODE_ENV || "development",
};

if (config.nodeEnv === "production") {
  const requiredInProduction = [
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "MONGODB_URI",
    "FRONTEND_URL",
    "SEPAY_API_KEY",
    "SEPAY_BANK_ACCOUNT",
    "SEPAY_BANK_NAME",
  ];

  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(", ")}`,
    );
  }
}

module.exports = config;
