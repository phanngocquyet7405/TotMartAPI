const mongoose = require('mongoose');
const redis = require('../config/redis');
exports.summary = async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 15 * 60000);
    const checks = [['notificationOutbox', require('../models/NotificationOutbox'), { state: 'pending', createdAt: { $lt: cutoff } }],
      ['securityOutbox', require('../models/SecurityOutbox'), { state: 'pending', createdAt: { $lt: cutoff } }],
      ['pendingRefunds', require('../models/ReceiptRefund'), { status: 'pending' }]];
    const values = await Promise.all(checks.map(async ([key, model, filter]) => [key, await model.countDocuments(filter)]));
    const queues = Object.fromEntries(values);
    const alerts = Object.entries(queues).filter(([key, count]) => key !== 'pendingRefunds' && count > 0).map(([queue, count]) => ({ queue, count, reason: 'Pending for more than 15 minutes' }));
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { observedAt: new Date(), databaseConnected: mongoose.connection.readyState === 1, redisReady: redis.ready(), queues, alerts } });
  } catch (error) { next(error); }
};
