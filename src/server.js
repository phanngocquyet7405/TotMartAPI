const app = require("./app");
const { connectDB } = require("./config/database");
const config = require("./config/environment");
const logger = require("./utils/logger");
const { startDeliveryScheduler } = require("./jobs/deliveryScheduler");
const { startOrderExpiryScheduler } = require("./jobs/orderExpiryScheduler");

const server = async () => {
  const requiredEnvVars = [
    "MONGODB_URI",
    "JWT_SECRET",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "SEPAY_API_KEY",
  ];

  const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
  if (missingVars.length > 0) {
    logger.error(
      { missingVars },
      "[FATAL ERROR] Không thể khởi động Server. Thiếu các biến môi trường",
    );
    process.exit(1);
  }
  try {
    await connectDB();

    const PORT = config.port;
    const httpServer = app.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}/api/home/health`);
      logger.info(`Environment: ${config.nodeEnv}`);

      startDeliveryScheduler();
      startOrderExpiryScheduler();
    });

    return httpServer;
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

function gracefulShutdown(httpServer, reason, error) {
  const exitCode = reason === "SIGTERM" ? 0 : 1;
  logger.error({ err: error }, `[${reason}] Server đang tắt...`);
  if (!httpServer) {
    process.exit(exitCode);
    return;
  }

  const forceExitTimer = setTimeout(() => {
    logger.error("Đóng server quá thời gian cho phép, buộc thoát.");
    process.exit(exitCode);
  }, 10_000);
  forceExitTimer.unref();

  httpServer.close(async () => {
    try {
      const { disconnectDB } = require("./config/database");
      await disconnectDB();
    } catch (closeErr) {
      logger.error({ err: closeErr }, "Lỗi khi đóng kết nối DB");
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    }
  });
}

server().then((httpServer) => {
  process.on("unhandledRejection", (error) => {
    gracefulShutdown(httpServer, "Unhandled Rejection", error);
  });

  process.on("uncaughtException", (error) => {
    gracefulShutdown(httpServer, "Uncaught Exception", error);
  });

  process.on("SIGTERM", () => {
    logger.info("Nhận SIGTERM, đang tắt server...");
    gracefulShutdown(httpServer, "SIGTERM");
  });
});
