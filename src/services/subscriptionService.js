const mongoose = require('mongoose');
const Subscription = require('../models/UserSubscription');
const Fulfillment = require('../models/SubscriptionFulfillment');
const Box = require('../models/Box');
const { deductStock } = require('./inventoryService');
const { fail } = require('./pricingService');
const OFFSET = 7 * 3600000;
function planMonths(type) { const months = { '1_month': 1, '3_month': 3, '6_month': 6, '12_month': 12 }[type]; if (!months) fail('Loại gói không hợp lệ'); return months; }
function prepaidPrice(boxValue, type, discountPercent = 0) {
  const basePrice = Math.round(boxValue) * planMonths(type);
  const discountPrice = Math.round(basePrice * (1 - discountPercent / 100));
  if (!Number.isSafeInteger(basePrice) || basePrice <= 0 || discountPercent < 0 || discountPercent >= 100 || !Number.isSafeInteger(discountPrice) || discountPrice <= 0) fail('Giá gói trả trước không hợp lệ');
  return { basePrice, discountPrice };
}
function addMonths(anchor, months) {
  const local = new Date(new Date(anchor).getTime() + OFFSET), day = local.getUTCDate();
  local.setUTCDate(1); local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last)); return new Date(local.getTime() - OFFSET);
}
async function activateSubscription(sub, session, now = new Date()) {
  sub.status = 'active'; sub.paymentStatus = 'paid'; sub.paidAt = now;
  sub.currentPeriodStart = now; sub.currentPeriodEnd = addMonths(now, sub.totalDeliveries);
  sub.nextDeliveries = addMonths(now, 1); await sub.save({ session });
}
async function createDueFulfillments(now = new Date()) {
  const subscriptions = await Subscription.find({ status: 'active', paymentStatus: 'paid', nextDeliveries: { $lte: now }, remainDeliveries: { $gt: 0 } });
  for (const sub of subscriptions) {
    try {
      await Fulfillment.updateOne({ subscriptionId: sub._id, sequence: sub.completeDeliveries + 1 },
        { $setOnInsert: { subscriptionId: sub._id, userId: sub.userId, sequence: sub.completeDeliveries + 1, dueAt: sub.nextDeliveries } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  return subscriptions.length;
}
async function transitionFulfillment(id, userId, delivered, trackingReference) {
  const session = await mongoose.startSession(); let fulfillment;
  try {
    await session.withTransaction(async () => {
      fulfillment = await Fulfillment.findById(id).session(session);
      if (!fulfillment) fail('Không tìm thấy lượt giao', 404);
      if (fulfillment.state === (delivered ? 'delivered' : 'dispatched')) return;
      if (fulfillment.state !== (delivered ? 'dispatched' : 'pending')) fail('Trạng thái giao hàng không hợp lệ', 409);
      const sub = await Subscription.findById(fulfillment.subscriptionId).session(session);
      if (!sub || sub.status !== 'active' || sub.paymentStatus !== 'paid') fail('Gói không hoạt động', 409);
      if (fulfillment.sequence !== sub.completeDeliveries + 1) fail('Lượt giao không đúng thứ tự', 409);
      if (delivered) {
        sub.completeDeliveries += 1; sub.remainDeliveries = sub.totalDeliveries - sub.completeDeliveries;
        sub.lastDeliveries = new Date();
        if (sub.remainDeliveries === 0) { sub.status = 'expired'; sub.nextDeliveries = null; }
        else sub.nextDeliveries = addMonths(sub.currentPeriodStart, sub.completeDeliveries + 1);
        fulfillment.state = 'delivered'; fulfillment.deliveredAt = new Date(); fulfillment.deliveredBy = userId;
      } else {
        const boxes = [{ boxId: sub.boxId, quantity: 1 }];
        if (fulfillment.sequence === 1) for (const gift of sub.gift) boxes.push({ boxId: gift.boxId, quantity: gift.quantity });
        const parts = new Map(), snapshots = [];
        for (const entry of boxes) {
          const box = await Box.findById(entry.boxId).session(session);
          if (!box?.products.length) fail('Hộp không còn đủ cấu phần', 409);
          snapshots.push({ ...entry, name: box.name });
          for (const p of box.products) { const key = String(p.productId); const prev = parts.get(key); parts.set(key, { productId: p.productId, name: p.name || box.name, quantity: (prev?.quantity || 0) + p.quantity * entry.quantity }); }
        }
        fulfillment.products = [...parts.values()]; fulfillment.boxes = snapshots;
        await deductStock(fulfillment.products, session, fulfillment.boxes);
        fulfillment.state = 'dispatched'; fulfillment.dispatchedAt = new Date(); fulfillment.trackingReference = trackingReference;
      }
      // Touching sub prevents dispatch and cancellation committing concurrently.
      sub.fulfillmentRevision = (sub.fulfillmentRevision || 0) + 1;
      await sub.save({ session }); await fulfillment.save({ session });
    });
    return fulfillment;
  } finally { await session.endSession(); }
}
module.exports = { planMonths, prepaidPrice, addMonths, activateSubscription, createDueFulfillments, transitionFulfillment };
