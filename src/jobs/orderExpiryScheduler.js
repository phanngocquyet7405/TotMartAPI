const mongoose = require('mongoose');
const cron = require('node-cron');
const Checkout = require('../models/Checkout');
const Order = require('../models/Order');
const Subscription = require('../models/UserSubscription');
const { lockCheckout, releaseCoupon } = require('../services/checkoutLifecycle');
const { enqueue } = require('./notificationOutboxScheduler');
const logger = require('../utils/logger');
async function expireCheckout(code, now) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const checkout = await lockCheckout(code, session);
      if (!checkout || checkout.state !== 'pending' || checkout.paymentMethod !== 'online' || checkout.expiresAt > now) return;
      const orders = await Order.find({ paymentCode: code }).session(session);
      if (orders.some(o => o.paymentStatus === 'paid')) return;
      for (const order of orders) {
        if (order.status !== 'pending') continue;
        order.status = 'cancelled'; order.cancelReason = 'Hết hạn thanh toán'; order._statusChangeNote = 'Hủy tự động khi quá hạn';
        await order.save({ session }); await enqueue(order, 'order_cancelled', session);
      }
      if (checkout.subscriptionId) await Subscription.updateOne({ _id: checkout.subscriptionId, status: 'pending_payment' }, { status: 'cancelled', nextDeliveries: null }, { session });
      await releaseCoupon(checkout, session); checkout.state = 'cancelled'; await checkout.save({ session });
    });
  } finally { await session.endSession(); }
}
async function expireStaleOrders(now = new Date()) {
  const due = await Checkout.find({ state: 'pending', paymentMethod: 'online', expiresAt: { $lte: now } }).select('paymentCode').limit(200);
  for (const checkout of due) { try { await expireCheckout(checkout.paymentCode, now); } catch (err) { logger.error({ err, paymentCode: checkout.paymentCode }, 'Expiry failed; retry next run'); } }
}
function startOrderExpiryScheduler() { const run = () => expireStaleOrders().catch(err => logger.error({ err }, 'Expiry job failed')); void run(); return cron.schedule('* * * * *', run); }
module.exports = { expireStaleOrders, expireCheckout, startOrderExpiryScheduler };
