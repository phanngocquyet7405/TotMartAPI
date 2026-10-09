const cron = require('node-cron');
const Fulfillment = require('../models/SubscriptionFulfillment');
const { createDueFulfillments } = require('../services/subscriptionService');
const logger = require('../utils/logger');
async function processDeliveries() { return createDueFulfillments(); }
async function checkTodayDeliveries(shouldLog = true, userId) {
  const filter = { state: { $in: ['pending', 'dispatched'] }, dueAt: { $lte: new Date() } };
  if (userId) filter.userId = userId;
  const deliveries = await Fulfillment.find(filter).sort({ dueAt: 1 }).limit(100)
    .populate({ path: 'subscriptionId', populate: [{ path: 'userId', select: 'name email' }, { path: 'boxId', select: 'name' }] });
  if (shouldLog) logger.info({ count: deliveries.length }, 'Subscription fulfillments due');
  return { success: true, date: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10), count: deliveries.length, deliveries };
}
function startDeliveryScheduler() {
  const run = () => processDeliveries().catch(err => logger.error({ err }, 'Delivery scheduling failed'));
  void run(); return cron.schedule('*/15 * * * *', run, { timezone: 'Asia/Ho_Chi_Minh' });
}
module.exports = { processDeliveries, checkTodayDeliveries, startDeliveryScheduler };
