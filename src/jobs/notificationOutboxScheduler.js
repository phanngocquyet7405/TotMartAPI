const Outbox = require('../models/NotificationOutbox');
const Order = require('../models/Order');
const { notifyMerchant } = require('../utils/notify');
const logger = require('../utils/logger');
async function enqueue(order, type, session) {
  const eventKey = `${order._id}:${type}`;
  await Outbox.updateOne({ eventKey }, { $setOnInsert: { eventKey, orderId: order._id, type } }, { upsert: true, session });
}
async function drain(limit = 50) {
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const event = await Outbox.findOneAndUpdate({ state: 'pending', nextAttempt: { $lte: now }, leaseUntil: { $lte: now } },
      { $set: { leaseUntil: new Date(now.getTime() + 60000) }, $inc: { attempts: 1 } }, { new: true });
    if (!event) break;
    try {
      const order = await Order.findById(event.orderId);
      if (!order) throw new Error('Outbox order missing');
      await notifyMerchant(order, event.type, event.eventKey);
      await Outbox.updateOne({ _id: event._id }, { state: 'delivered', deliveredAt: new Date() });
    } catch (err) {
      logger.error({ err, eventId: event._id }, 'Notification outbox retry');
      await Outbox.updateOne({ _id: event._id }, { leaseUntil: new Date(0), nextAttempt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(event.attempts, 10))) });
    }
  }
}
function start() { const timer = setInterval(() => drain().catch(err => logger.error({ err }, 'Outbox worker failed')), 10000); timer.unref(); return timer; }
module.exports = { enqueue, drain, start };
