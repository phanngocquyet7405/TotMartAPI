const mongoose = require('mongoose');
const crypto = require('crypto');
const Event = require('../models/PaymentEvent');
const Allocation = require('../models/PaymentAllocation');
const Audit = require('../models/PaymentAudit');
const Refund = require('../models/ReceiptRefund');
const Checkout = require('../models/Checkout');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Subscription = require('../models/UserSubscription');
const { lockCheckout, requestHash } = require('./checkoutLifecycle');
const { reserveOrder, restoreStock } = require('./inventoryService');
const { activateSubscription } = require('./subscriptionService');
const { enqueue } = require('../jobs/notificationOutboxScheduler');
const { fail, money, sumMoney, receiptHash, paymentCodeFrom } = require('./paymentPolicy');

function sameActor(a, b) {
  return String(a || '') === String(b || '');
}
async function command(meta, payload, operation) {
  const hash = requestHash({ ...payload, reason: meta.reason });
  let result;
  const replay = (audit) => {
    if (audit.requestHash !== hash || !sameActor(audit.actorId, meta.actorId))
      fail('Idempotency key đã được dùng cho thao tác khác');
    return { ...audit.result, replayed: true };
  };
  try {
    await mongoose.connection.transaction(async (session) => {
      const previous = await Audit.findOne({ key: meta.key }).session(session);
      if (previous) {
        result = replay(previous);
        return;
      }
      result = await operation(session);
      await Audit.create([{ ...meta, requestHash: hash, result }], { session });
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const previous = await Audit.findOne({ key: meta.key });
    if (!previous) fail('Giao dịch đã được xử lý bởi thao tác khác');
    result = replay(previous);
  }
  return result;
}

async function queueRefund(data, session, actorId) {
  if (!session?.inTransaction()) throw new Error('Refund queue requires transaction');
  money(data.amount);
  const existing = await Refund.findOne({ key: data.key }).session(session);
  if (existing) {
    if (existing.amount !== data.amount || existing.purpose !== data.purpose)
      fail('Khoản hoàn đã tồn tại với số tiền khác');
    return existing;
  }
  const [refund] = await Refund.create([data], { session });
  await Audit.create(
    [
      {
        key: `refund-queued:${data.key}`,
        requestHash: requestHash({ key: data.key, amount: data.amount }),
        actorId,
        source: actorId ? 'admin' : 'system',
        action: 'refund_queued',
        reason: data.reason,
        checkoutId: data.checkoutId,
        result: { refundId: String(refund._id), amount: refund.amount },
      },
    ],
    { session },
  );
  return refund;
}
async function queueUnpaidRefund(checkout, session, reason, actorId) {
  if (!checkout || checkout.paymentLedgerVersion !== 2 || !checkout.receivedAmount) return;
  if (checkout.state === 'paid') fail('Không hoàn tiền chưa thanh toán cho checkout đã paid');
  await queueRefund(
    {
      key: `unpaid:${checkout._id}`,
      checkoutId: checkout._id,
      purpose: 'unpaid',
      amount: checkout.receivedAmount,
      reason,
    },
    session,
    actorId,
  );
}

async function settle(checkout, orders, session, referenceCode) {
  if (checkout.kind === 'subscription') {
    const sub = await Subscription.findById(checkout.subscriptionId).session(session);
    if (!sub || sub.status !== 'pending_payment' || sub.paymentStatus !== 'pending')
      fail('Subscription không thể kích hoạt');
    if (!sub.boxVersionId || sub.gift.some((g) => !g.versionId))
      fail('Subscription thiếu snapshot đã mua');
    await activateSubscription(sub, session);
  } else {
    // If orders were not created at checkout (online session flow), create them now from snapshot
    if (!orders.length) {
      if (!checkout.snapshot?.orderGroups?.length) fail('Thiếu snapshot để tạo đơn hàng');
      const created = [];
      for (const group of checkout.snapshot.orderGroups) {
        const [order] = await Order.create(
          [
            {
              userId: checkout.userId,
              merchantId: group.merchantId,
              paymentCode: checkout.paymentCode,
              customerEmail: group.customerEmail,
              products: group.products,
              boxes: group.boxes,
              orderId: 'ORD' + crypto.randomBytes(12).toString('hex').toUpperCase(),
              totalAmount: group.totalAmount,
              giftFee: group.giftFee,
              bulkDiscountAmount: group.bulkDiscountAmount,
              pricingPolicyVersion: group.pricingPolicyVersion,
              shippingFee: group.shippingFee,
              shippingPayment: group.shippingPayment,
              shippingMode: group.shippingMode,
              discountAmount: group.discountAmount,
              couponCode: group.couponCode,
              shippingAddress: group.shippingAddress,
              paymentMethod: 'online',
              note: group.note,
              status: 'pending',
              paymentStatus: 'pending',
              stockDeducted: false,
            },
          ],
          { session },
        );
        created.push(order);
      }
      orders = created;
      checkout.orderIds = created.map((o) => o._id);
      // Empty user's cart now that order is confirmed and paid
      await Cart.deleteOne({ userId: checkout.userId, isSubscribeCart: false }, { session });
    }

    if (
      !orders.length ||
      orders.some(
        (o) =>
          o.paymentMethod !== 'online' || o.status !== 'pending' || o.paymentStatus !== 'pending',
      )
    )
      fail('Nhóm đơn không thể thanh toán');
    if (
      orders.some((o) => !Number.isSafeInteger(o.totalAmount) || o.totalAmount < 0) ||
      sumMoney(orders.map((o) => o.totalAmount).filter((n) => n > 0)) !== checkout.totalAmount
    )
      fail('Tổng đơn con không khớp checkout');
    for (const [index, order] of orders.entries()) {
      if (index === 0) order.paidReferenceCode = referenceCode;
      order.overpaidAmount = 0;
      order.isOverpaid = false;
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
      await reserveOrder(order, session);
      await order.save({ session });
    }
    if (orders.some((o) => o.boxes?.length) && orders.some((o) => o.status === 'on_hold')) {
      for (const order of orders) {
        if (order.stockDeducted) await restoreStock(order.products, session, order.boxes);
        order.stockDeducted = false;
        order.status = 'on_hold';
        await order.save({ session });
      }
    }
    for (const order of orders) await enqueue(order, 'payment_received', session);
  }
  checkout.state = 'paid';
  checkout.paidReferenceCode = referenceCode;
  if (orders.length > 0) {
    checkout.result = {
      ...checkout.result,
      orderId: String(orders[0]._id),
      orderCode: checkout.paymentCode,
      status: 'paid',
    };
  }
  const surplus = checkout.receivedAmount - checkout.totalAmount;
  // This field is display-only. Cancellation never adds it to principal refunds.
  checkout.overpaidAmount = surplus;
  if (surplus > 0)
    await queueRefund(
      {
        key: `surplus:${checkout._id}`,
        checkoutId: checkout._id,
        purpose: 'surplus',
        amount: surplus,
        reason: 'Tiền thừa sau khi đủ giá trị checkout',
      },
      session,
    );
}

async function applyReceipts({
  paymentCode,
  eventIds,
  key,
  actorId,
  reason,
  source = 'admin',
  allowUnmatched = false,
}) {
  const ids = [...new Set(eventIds.map(String))].sort();
  if (!ids.length || ids.length > 50 || ids.some((id) => !mongoose.isObjectIdOrHexString(id)))
    fail('Danh sách receipt không hợp lệ', 400);
  return command(
    { key, actorId, source, action: 'allocate_receipts', reason },
    { paymentCode, ids, allowUnmatched },
    async (session) => {
      const checkout = await lockCheckout(paymentCode, session);
      if (
        !checkout ||
        checkout.paymentLedgerVersion !== 2 ||
        checkout.state !== 'pending' ||
        checkout.paymentMethod !== 'online' ||
        checkout.expiresAt <= new Date()
      )
        fail('Checkout không thể nhận phân bổ');
      const orders = await Order.find({ paymentCode }).sort({ _id: 1 }).session(session);
      if (orders.some((o) => o.status !== 'pending' || o.paymentStatus !== 'pending'))
        fail('Đơn không còn pending');
      const events = await Event.find({ _id: { $in: ids } })
        .sort({ _id: 1 })
        .session(session);
      if (events.length !== ids.length) fail('Receipt không tồn tại', 404);
      for (const event of events) {
        if (event.paymentLedgerVersion !== 2 || event.disposition !== 'unallocated')
          fail('Receipt đã xử lý hoặc thuộc dữ liệu legacy');
        if (event.paymentCode !== paymentCode) {
          if (!allowUnmatched || !actorId) fail('Receipt không khớp checkout');
          // Never steal a receipt from another known checkout.
          if (
            event.paymentCode &&
            (await Checkout.exists({ paymentCode: event.paymentCode }).session(session))
          )
            fail('Receipt thuộc checkout khác');
        }
        await Allocation.create(
          [{ eventId: event._id, checkoutId: checkout._id, amount: money(event.transferAmount) }],
          { session },
        );
        event.disposition = 'applied';
        event.state = 'underpaid';
        event.errorCode = undefined;
        await event.save({ session });
      }
      const allocations = await Allocation.find({ checkoutId: checkout._id }).session(session);
      checkout.receivedAmount = sumMoney(allocations.map((a) => a.amount));
      if (checkout.receivedAmount >= checkout.totalAmount) {
        await settle(checkout, orders, session, events[events.length - 1].referenceCode);
        await Event.updateMany(
          { _id: { $in: allocations.map((a) => a.eventId) } },
          { $set: { state: 'processed', processedAt: new Date() } },
          { session },
        );
      }
      await checkout.save({ session });
      return {
        checkoutId: String(checkout._id),
        paymentCode,
        state: checkout.state,
        totalAmount: checkout.totalAmount,
        receivedAmount: checkout.receivedAmount,
        remainingAmount: Math.max(0, checkout.totalAmount - checkout.receivedAmount),
      };
    },
  );
}

async function refundReceipt({ eventId, key, actorId, reason, source = 'admin' }) {
  return command(
    { key, actorId, reason, source, action: 'refund_receipt' },
    { eventId: String(eventId) },
    async (session) => {
      const event = await Event.findOneAndUpdate(
        { _id: eventId, paymentLedgerVersion: 2, disposition: 'unallocated' },
        { $set: { disposition: 'refund_pending', state: 'not_payable' } },
        { new: true, session },
      );
      if (!event) fail('Receipt không ở trạng thái có thể hoàn');
      const checkout = event.paymentCode
        ? await Checkout.findOne({ paymentCode: event.paymentCode }).session(session)
        : null;
      const refund = await queueRefund(
        {
          key: `receipt:${event._id}`,
          eventId: event._id,
          checkoutId: checkout?._id,
          purpose: 'receipt',
          amount: event.transferAmount,
          reason,
        },
        session,
        actorId,
      );
      return { refundId: String(refund._id), amount: refund.amount, state: 'refund_pending' };
    },
  );
}

async function processReceipt(eventId, source = 'worker') {
  const event = await Event.findById(eventId);
  if (!event || event.paymentLedgerVersion !== 2) fail('Receipt cần review legacy');
  if (event.disposition !== 'unallocated') return { replayed: true, state: event.disposition };
  const checkout = event.paymentCode
    ? await Checkout.findOne({ paymentCode: event.paymentCode })
    : null;
  if (!checkout) {
    await Event.updateOne(
      { _id: eventId, disposition: 'unallocated' },
      { $set: { state: 'unmatched' } },
    );
    return { state: 'unmatched' };
  }
  if (checkout.paymentLedgerVersion !== 2) {
    await Event.updateOne(
      { _id: eventId, disposition: 'unallocated' },
      { $set: { state: 'legacy_review' } },
    );
    return { state: 'legacy_review' };
  }
  if (
    checkout.state !== 'pending' ||
    checkout.paymentMethod !== 'online' ||
    checkout.expiresAt <= new Date()
  )
    return refundReceipt({
      eventId,
      key: `auto-refund:${eventId}`,
      reason: 'Checkout đã hết hạn/huỷ/paid hoặc không nhận online',
      source,
    });
  try {
    return await applyReceipts({
      paymentCode: checkout.paymentCode,
      eventIds: [eventId],
      key: `auto-allocate:${eventId}`,
      reason: 'Phân bổ receipt SePay',
      source,
    });
  } catch (err) {
    // A concurrent expiry/payment may have won the checkout guard. Re-read safely.
    const fresh = await Event.findById(eventId);
    if (fresh?.disposition !== 'unallocated') return { replayed: true, state: fresh?.disposition };
    const current = await Checkout.findById(checkout._id);
    if (current && (current.state !== 'pending' || current.expiresAt <= new Date()))
      return refundReceipt({
        eventId,
        key: `auto-refund:${eventId}`,
        reason: 'Checkout đóng trong lúc đối soát',
        source,
      });
    throw err;
  }
}

async function receiveWebhook(body) {
  if (body.transferType !== 'in') return { ignored: true };
  if (!require('../config/environment').sepay.bankAccount)
    fail('Chưa cấu hình tài khoản SePay', 503);
  if (body.accountNumber !== require('../config/environment').sepay.bankAccount)
    fail('Unexpected receiving account', 400);
  money(body.transferAmount);
  const hash = receiptHash(body),
    code = paymentCodeFrom(body);
  const identity = { accountNumber: body.accountNumber, providerEventId: String(body.id) };
  let event;
  try {
    event = await Event.findOneAndUpdate(
      identity,
      {
        $setOnInsert: {
          ...identity,
          referenceCode: body.referenceCode,
          payloadHash: hash,
          paymentCode: code,
          transferAmount: body.transferAmount,
          paymentLedgerVersion: 2,
          disposition: 'unallocated',
          state: 'received',
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    event = await Event.findOne({ $or: [identity, { referenceCode: body.referenceCode }] });
    if (!event) throw err;
  }
  if (event.paymentLedgerVersion === 1) {
    const legacyHash = requestHash({
      code,
      amount: body.transferAmount,
      account: body.accountNumber,
    });
    if (event.payloadHash !== legacyHash) fail('Receipt legacy có nội dung khác; cần review');
    return {
      eventId: String(event._id),
      replayed: true,
      state: event.state === 'processed' ? 'legacy_processed' : 'legacy_review',
    };
  }
  if (event.paymentLedgerVersion !== 2 || event.payloadHash !== hash)
    fail('Receipt identity có nội dung khác; cần review');
  await Event.updateOne({ _id: event._id }, { $inc: { attempts: 1 } });
  // Receipt is durable before acknowledgement. Worker retries settlement failures.
  try {
    return { eventId: String(event._id), ...(await processReceipt(event._id, 'webhook')) };
  } catch (err) {
    await Event.updateOne(
      { _id: event._id, disposition: 'unallocated' },
      { $set: { state: 'retry_required', errorCode: String(err.statusCode || 503) } },
    );
    require('../utils/logger').error(
      { err, eventId: String(event._id) },
      'Receipt persisted; reconciliation worker will retry',
    );
    return { eventId: String(event._id), state: 'retry_required' };
  }
}

async function completeRefund({ refundId, amount, reference, evidence, key, actorId }) {
  money(amount);
  return command(
    { key, actorId, source: 'admin', action: 'refund_completed', reason: evidence },
    { refundId: String(refundId), amount, reference, evidence },
    async (session) => {
      const refund = await Refund.findById(refundId).session(session);
      if (!refund || refund.status !== 'pending' || refund.amount !== amount)
        fail('Khoản hoàn hoặc số tiền không khớp');
      if (refund.checkoutId) {
        const checkout = await Checkout.findById(refund.checkoutId).session(session);
        if (checkout) await lockCheckout(checkout.paymentCode, session);
      }
      refund.status = 'completed';
      refund.bankReference = reference;
      refund.evidence = evidence;
      refund.completedBy = actorId;
      refund.completedAt = new Date();
      await refund.save({ session });
      if (refund.eventId)
        await Event.updateOne(
          { _id: refund.eventId, disposition: 'refund_pending' },
          { $set: { disposition: 'refunded' } },
          { session },
        );
      const patch = {
        refundStatus: 'completed',
        refundReference: reference,
        refundedAt: refund.completedAt,
        refundedBy: actorId,
      };
      if (refund.orderId) {
        const result = await Order.updateOne(
          { _id: refund.orderId, refundStatus: 'pending', refundAmount: amount },
          { $set: patch },
          { session },
        );
        if (result.matchedCount !== 1) fail('Order refund state không khớp ledger');
      }
      if (refund.subscriptionId) {
        const result = await Subscription.updateOne(
          { _id: refund.subscriptionId, refundStatus: 'pending', refundAmount: amount },
          { $set: patch },
          { session },
        );
        if (result.matchedCount !== 1) fail('Subscription refund state không khớp ledger');
      }
      return { refundId: String(refund._id), status: 'completed', amount };
    },
  );
}
module.exports = {
  receiveWebhook,
  processReceipt,
  applyReceipts,
  refundReceipt,
  completeRefund,
  queueRefund,
  queueUnpaidRefund,
};
