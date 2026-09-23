const app = require("./app");
const { connectDB } = require("./config/database");
const config = require("./config/environment");
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
    console.error(
      `[FATAL ERROR] Không thể khởi động Server. Thiếu các biến môi trường: ${missingVars.join(", ")}`,
    );
    process.exit(1);
  }
  try {
    await connectDB();

    const PORT = config.port;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}/api/home/health`);
      console.log(`Environment: ${config.nodeEnv}`);

      startDeliveryScheduler();
      startOrderExpiryScheduler();
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error.message);
  process.exit(1);
});

server();
