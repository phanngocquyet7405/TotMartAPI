const mongoose = require('mongoose');
const redis = require('../config/redis');
exports.summary = async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 15 * 60000);
    const checks = [['notificationOutbox', require('../models/NotificationOutbox'), { state: 'pending', createdAt: { $lt: cutoff } }],
      ['securityOutbox', require('../models/SecurityOutbox'), { state: 'pending', createdAt: { $lt: cutoff } }],
      ['pendingRefunds', require('../models/ReceiptRefund'), { status: 'pending' }],
      ['overdueRefunds', require('../models/ReceiptRefund'), { status: 'pending', createdAt: { $lt: new Date(Date.now() - 86400000) } }],
      ['webhookRetries', require('../models/PaymentEvent'), { state: 'retry_required', createdAt: { $lt: cutoff } }]];
    const values = await Promise.all(checks.map(async ([key, model, filter]) => [key, await model.countDocuments(filter)]));
    const queues = Object.fromEntries(values);
    const Attempt = require('../models/CheckoutAttempt');
    const [attemptTotal, attemptLast24h, highWater] = await Promise.all([
      Attempt.countDocuments(), Attempt.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
      Attempt.aggregate([{ $group: { _id: '$userId', count: { $sum: 1 } } }, { $match: { count: { $gte: 8000 } } }, { $count: 'users' }]),
    ]);
    const alerts = Object.entries(queues).filter(([key, count]) => key !== 'pendingRefunds' && count > 0).map(([queue, count]) => ({ queue, count, reason: queue === 'overdueRefunds' ? 'Refund pending for more than 24 hours' : 'Unresolved for more than 15 minutes' }));
    if (attemptLast24h >= 100000) alerts.push({ queue: 'attemptGrowth', count: attemptLast24h, reason: 'At least 100000 new references in 24 hours; review traffic and storage capacity' });
    res.set('Cache-Control', 'no-store');
    if (highWater.length) alerts.push({ queue: 'attemptCapacity', count: highWater[0].users, reason: 'Users at >= 8000 durable references; review abuse/capacity, never delete tombstones' });
    res.json({ success: true, data: { observedAt: new Date(), databaseConnected: mongoose.connection.readyState === 1, redisReady: redis.ready(), queues, alerts, attempts: { total: attemptTotal, last24h: attemptLast24h, highWaterUsers: highWater[0]?.users || 0, perUserLimit: 10000 } } });
  } catch (error) { next(error); }
};
