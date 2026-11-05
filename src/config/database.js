const mongoose = require('mongoose');
const config = require('./environment');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    logger.info({ dependency: 'MongoDB' }, 'Đang kết nối tới MongoDB');
    const conn = await mongoose.connect(config.mongodb.uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20,
      autoIndex: config.nodeEnv !== 'production',
    });
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error({ dependency: 'MongoDB', event: 'connect_failed' }, 'Lỗi kết nối MongoDB');
    throw error;
  }
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB Disconnected');
};

module.exports = {
  connectDB,
  disconnectDB,
};
