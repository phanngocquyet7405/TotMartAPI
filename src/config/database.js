const mongoose = require("mongoose");
const config = require("./environment");
const logger = require("../utils/logger");

function maskUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
}

const connectDB = async () => {
  try {
    logger.info(
      { uri: maskUri(config.mongodb.uri) },
      "Đang kết nối tới MongoDB",
    );
    const conn = await mongoose.connect(config.mongodb.uri);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error({ err: error }, "Lỗi kết nối MongoDB");
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB Disconnected");
};

module.exports = {
  connectDB,
  disconnectDB,
};
