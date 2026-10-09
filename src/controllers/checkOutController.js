const mongoose = require('mongoose');
const crypto = require('crypto');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const Checkout = require('../models/Checkout');
const PaymentEvent = require('../models/PaymentEvent');
const Subscription = require('../models/UserSubscription');
const { buildQuote, allocate, fail } = require('../services/pricingService');
const { deductStock, restoreStock, reserveOrder } = require('../services/inventoryService');
const { requestHash, paymentCode, lockCheckout, replay, releaseCoupon, qrUrl } = require('../services/checkoutLifecycle');
const { enqueue, drain } = require('../jobs/notificationOutboxScheduler');
const { activateSubscription } = require('../services/subscriptionService');
const config = require('../config/environment');
const logger = require('../utils/logger');

function requestKey(req) {
  const key = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
  if (key && !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('Idempotency-Key không hợp lệ');
  return key || crypto.randomUUID();
}
const flush = () => drain().catch(err => logger.error({ err }, 'Outbox delivery deferred'));
class CheckOutController {
  async quote(req, res, next) {
    try {
      const { items, couponCode } = req.validatedBody;
      const quote = await buildQuote(items, couponCode);
      const { products, boxes, ...data } = quote;
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
  async checkOut(req, res, next) {
    let session, key, hash, result;
    try {
      key = requestKey(req); hash = requestHash(req.validatedBody);
      const previous = await replay(req.userId, key, hash);
      if (previous) return res.status(201).json({ success: true, data: previous.result });
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const existing = await replay(req.userId, key, hash, session);
        if (existing) { result = existing.result; return; }
        const { addressId, paymentMethod, note, couponCode, quoteFingerprint } = req.validatedBody;
        const user = await User.findById(req.userId).session(session);
        const address = user?.addresses.id(addressId);
        if (!address) fail('Địa chỉ không hợp lệ');
        const cart = await Cart.findOne({ userId: req.userId, isSubscribeCart: false }).session(session);
        const quote = await buildQuote(cart?.items, couponCode, session, true);
        if (quoteFingerprint && quoteFingerprint !== quote.fingerprint) fail('Giá hoặc giỏ hàng đã thay đổi. Vui lòng kiểm tra lại báo giá.', 409);
        if (paymentMethod === 'online' && quote.totalAmount <= 0) fail('Thanh toán online cần số tiền lớn hơn 0');
        const grouped = new Map();
        for (const p of quote.products) { const id = String(p.merchantId); if (!grouped.has(id)) grouped.set(id, []); grouped.get(id).push(p); }
        const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
        const discounts = allocate(quote.discountAmount, groups.map(([, products]) => products.reduce((sum, p) => sum + p.totalPrice, 0)));
        const code = paymentCode(), created = [];
        for (const [index, [merchantId, products]] of groups.entries()) {
          const subtotal = products.reduce((sum, p) => sum + p.totalPrice, 0);
          const shippingFee = index === 0 ? quote.shippingFee : 0;
          const boxes = index === 0 ? quote.boxes : [];
          const [order] = await Order.create([{
            userId: req.userId, merchantId, paymentCode: code, customerEmail: user.email,
            products, boxes, orderId: 'ORD' + crypto.randomBytes(12).toString('hex').toUpperCase(),
            totalAmount: subtotal - discounts[index] + shippingFee, shippingFee, discountAmount: discounts[index], couponCode: quote.couponCode,
            shippingAddress: { fullName: user.name, phone: address.phone, address: address.address, district: address.district, city: address.city, country: address.country },
            paymentMethod, note, stockDeducted: paymentMethod === 'cod',
          }], { session });
          if (paymentMethod === 'cod') { await deductStock(products, session, boxes); await enqueue(order, 'new_order', session); }
          created.push(order);
        }
        result = { orderId: String(created[0]._id), orderCode: code, totalAmount: quote.totalAmount };
        await Checkout.create([{ userId: req.userId, requestKey: key, requestHash: hash, paymentCode: code,
          orderIds: created.map(o => o._id), totalAmount: quote.totalAmount, paymentMethod,
          expiresAt: new Date(Date.now() + config.orderExpiryHours * 3600000), couponCode: quote.couponCode, result }], { session });
        await Cart.deleteOne({ _id: cart._id }, { session });
      });
      res.status(201).json({ success: true, data: result }); void flush();
    } catch (err) {
      if (err.code === 11000 && key) {
        try { const previous = await replay(req.userId, key, hash); if (previous) return res.status(201).json({ success: true, data: previous.result }); } catch (replayError) { return next(replayError); }
      }
      next(err);
    } finally { if (session) await session.endSession(); }
  }
  async sepayWebhook(req, res) {
    const body = req.validatedBody;
    if (body.transferType !== 'in') return res.json({ success: true });
    if (body.accountNumber !== process.env.SEPAY_BANK_ACCOUNT) return res.status(400).json({ success: false, message: 'Unexpected receiving account' });
    const code = (body.code || body.content.match(/TMART[A-Z0-9]+/i)?.[0] || '').toUpperCase();
    const hash = requestHash({ code, amount: body.transferAmount, account: body.accountNumber });
    let event, session;
    try {
      event = await PaymentEvent.findOneAndUpdate({ referenceCode: body.referenceCode }, { $setOnInsert: {
        referenceCode: body.referenceCode, paymentCode: code, transferAmount: body.transferAmount, payloadHash: hash,
      } }, { upsert: true, new: true });
      if (event.payloadHash !== hash) fail('Reference đã có nội dung khác; cần đối soát', 409);
      if (event.state === 'processed') return res.json({ success: true, message: 'Payment already processed' });
      await PaymentEvent.updateOne({ _id: event._id }, { $inc: { attempts: 1 } });
      session = await mongoose.startSession();
      let replayed = false, unmatched = false;
      await session.withTransaction(async () => {
        replayed = false; unmatched = false;
        const fresh = await PaymentEvent.findById(event._id).session(session);
        if (fresh.state === 'processed') { replayed = true; return; }
        const checkout = await lockCheckout(code, session);
        const orders = await Order.find({ paymentCode: code }).sort({ _id: 1 }).session(session);
        if (!checkout && !orders.length) { fresh.state = 'unmatched'; await fresh.save({ session }); unmatched = true; return; }
        const already = await Order.exists({ paidReferenceCode: body.referenceCode }).session(session);
        if (already || checkout?.paidReferenceCode === body.referenceCode) { fresh.state = 'processed'; await fresh.save({ session }); replayed = true; return; }
        if (checkout?.state === 'paid' || (orders.length && orders.every(o => o.paymentStatus === 'paid'))) fail('Checkout đã được trả tiền bởi giao dịch khác; cần đối soát', 409);
        if (checkout && (checkout.state !== 'pending' || checkout.paymentMethod !== 'online' || checkout.expiresAt <= new Date())) fail('Checkout không còn thanh toán được; cần đối soát', 409);
        if (orders.some(o => o.paymentMethod !== 'online' || o.status !== 'pending' || o.paymentStatus !== 'pending')) fail('Checkout không còn thanh toán được; cần đối soát', 409);
        const total = checkout?.totalAmount ?? orders.reduce((sum, o) => sum + o.totalAmount, 0);
        if (body.transferAmount < total) fail('Underpayment requires reconciliation', 422);
        if (checkout?.kind === 'subscription') {
          const sub = await Subscription.findById(checkout.subscriptionId).session(session);
          if (!sub || sub.status !== 'pending_payment') fail('Subscription không còn thanh toán được', 409);
          await activateSubscription(sub, session);
        }
        for (const [index, order] of orders.entries()) {
          if (index === 0) { order.paidReferenceCode = body.referenceCode; order.overpaidAmount = body.transferAmount - total; order.isOverpaid = body.transferAmount > total; }
          order.paymentStatus = 'paid'; order.paidAt = new Date();
          await reserveOrder(order, session);
          await order.save({ session }); await enqueue(order, 'payment_received', session);
        }
        // A box can contain components owned by several merchants. Keep its
        // entire checkout on hold if any component could not be reserved.
        if (orders.some(o => o.boxes?.length) && orders.some(o => o.status === 'on_hold')) {
          for (const order of orders) {
            if (order.stockDeducted) await restoreStock(order.products, session, order.boxes);
            order.stockDeducted = false; order.status = 'on_hold';
            await order.save({ session });
          }
        }
        if (checkout) { checkout.state = 'paid'; checkout.paidReferenceCode = body.referenceCode; checkout.overpaidAmount = body.transferAmount - total; await checkout.save({ session }); }
        fresh.state = 'processed'; fresh.processedAt = new Date(); fresh.errorCode = undefined; await fresh.save({ session });
      });
      res.json(replayed ? { success: true, message: 'Payment already processed' } : { success: true, ...(unmatched ? { message: 'Payment saved for reconciliation' } : {}) }); void flush();
    } catch (err) {
      if (event) await PaymentEvent.updateOne({ _id: event._id, state: { $ne: 'processed' } }, { state: err.statusCode === 422 ? 'underpaid' : err.statusCode === 409 ? 'not_payable' : 'retry_required', errorCode: String(err.statusCode || 503) }).catch(() => {});
      logger.error({ err, referenceCode: body.referenceCode }, 'Payment requires reconciliation');
      res.status(err.statusCode || 503).json({ success: false, message: err.statusCode ? err.message : 'Payment processing failed; retry required' });
    } finally { if (session) await session.endSession(); }
  }
  async getOrderStatus(req, res, next) {
    try {
      const checkout = await Checkout.findOne({ paymentCode: req.params.paymentCode });
      const orders = await Order.find({ paymentCode: req.params.paymentCode }).select('orderId userId status paymentStatus totalAmount paymentMethod');
      if (!checkout && !orders.length) fail('Không tìm thấy đơn hàng', 404);
      if (req.user.role !== 'admin' && String(checkout?.userId || orders[0].userId) !== req.userId) fail('Không có quyền xem đơn hàng này', 403);
      const paid = checkout?.state === 'paid' || (orders.length > 0 && orders.every(o => o.paymentStatus === 'paid'));
      const invalid = checkout?.state === 'cancelled' || (checkout?.expiresAt <= new Date() && !paid) || orders.some(o => ['cancelled', 'returned'].includes(o.status));
      const online = (checkout?.paymentMethod || orders[0]?.paymentMethod) === 'online';
      const payable = online && !paid && !invalid && orders.every(o => o.status === 'pending' && o.paymentStatus === 'pending');
      const totalAmount = checkout?.totalAmount ?? orders.reduce((sum, o) => sum + o.totalAmount, 0);
      const data = { paymentStatus: paid ? 'paid' : invalid ? 'cancelled' : 'pending', payable, totalAmount, expiresAt: checkout?.expiresAt,
        kind: checkout?.kind || 'products', orders: orders.map(o => ({ orderId: o.orderId, status: o.status, paymentStatus: o.paymentStatus, totalAmount: o.totalAmount })) };
      if (payable) data.qrUrl = qrUrl(req.params.paymentCode, totalAmount);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
  async confirmCodOrder(req, res, next) { return changeCod(req, res, next, false); }
  async markCodDelivered(req, res, next) { return changeCod(req, res, next, true); }
  async cancelOrder(req, res, next) {
    let session, cancelled;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const target = await Order.findById(req.params._id).session(session);
        if (!target) fail('Đơn hàng không tồn tại', 404);
        if (req.user.role !== 'admin' && String(target.userId) !== req.userId) fail('Không có quyền huỷ đơn hàng này', 403);
        if (!['pending', 'processing', 'on_hold'].includes(target.status)) fail('Đơn không thể hủy ở trạng thái hiện tại');
        const checkout = await lockCheckout(target.paymentCode, session);
        const siblings = await Order.find({ paymentCode: target.paymentCode }).session(session);
        const groupCancel = target.paymentMethod === 'online' && target.paymentStatus !== 'paid' || siblings.some(o => o.boxes?.length);
        const targets = groupCancel ? siblings.filter(o => o.status !== 'cancelled') : [target];
        if (targets.some(o => !['pending', 'processing', 'on_hold'].includes(o.status))) fail('Một phần đơn đã giao; cần xử lý hoàn/trả riêng', 409);
        for (const order of targets) {
          if (order.stockDeducted) { await restoreStock(order.products, session, order.boxes); order.stockDeducted = false; }
          if (order.paymentStatus === 'paid') { order.refundStatus = 'pending'; order.refundAmount = order.totalAmount + (order.overpaidAmount || 0); }
          order._statusChangedBy = req.userId; order.cancelReason = req.validatedBody?.reason || req.body?.reason || 'Không có lý do'; order.cancelledBy = req.userId; order.status = 'cancelled';
          await order.save({ session }); await enqueue(order, 'order_cancelled', session);
        }
        // The target fetched before locking is a different document instance.
        const allCancelled = siblings.every(o => targets.some(t => String(t._id) === String(o._id)) || o.status === 'cancelled');
        await releaseCoupon(checkout, session);
        if (checkout && allCancelled) { checkout.state = 'cancelled'; await checkout.save({ session }); }
        cancelled = targets.find(o => String(o._id) === String(target._id)) || target;
      });
      res.json({ success: true, message: 'Đã hủy đơn hàng', data: cancelled }); void flush();
    } catch (err) { next(err); } finally { if (session) await session.endSession(); }
  }
  async resolveInventoryHold(req, res, next) {
    let session, order;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        order = await Order.findOne({ _id: req.params._id, status: 'on_hold', paymentStatus: 'paid', stockDeducted: false }).session(session);
        if (!order) fail('Đơn không cần xử lý thiếu hàng', 409);
        await lockCheckout(order.paymentCode, session);
        const siblings = await Order.find({ paymentCode: order.paymentCode }).session(session);
        const targets = siblings.some(o => o.boxes?.length) ? siblings : [order];
        if (targets.some(o => o.status !== 'on_hold' || o.paymentStatus !== 'paid' || o.stockDeducted)) fail('Nhóm hộp không ở trạng thái có thể giữ kho', 409);
        for (const target of targets) {
          await deductStock(target.products, session, target.boxes);
          target.stockDeducted = true; target.status = 'processing'; target._statusChangedBy = req.userId; await target.save({ session });
        }
        order = targets.find(o => String(o._id) === String(req.params._id));
      });
      res.json({ success: true, data: order });
    } catch (err) { next(err); } finally { if (session) await session.endSession(); }
  }
  async getPendingRefunds(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
      const [data, total] = await Promise.all([Order.find({ refundStatus: 'pending' }).sort({ cancelledAt: -1 }).skip((page - 1) * limit).limit(limit), Order.countDocuments({ refundStatus: 'pending' })]);
      res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
  }
  async completeRefund(req, res, next) {
    try {
      const { reference, amount } = req.validatedBody;
      const order = await Order.findOneAndUpdate({ _id: req.params._id, refundStatus: 'pending', refundAmount: amount },
        { refundStatus: 'completed', refundedAt: new Date(), refundReference: reference, refundedBy: req.userId }, { new: true, runValidators: true });
      if (!order) fail('Đơn không chờ hoàn tiền hoặc số tiền không khớp', 409);
      res.json({ success: true, data: order });
    } catch (err) { next(err); }
  }
  async listPaymentEvents(req, res, next) {
    try { const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 50; const filter = req.query.state ? { state: req.query.state } : { state: { $ne: 'processed' } }; const [data, total] = await Promise.all([PaymentEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), PaymentEvent.countDocuments(filter)]); res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }); } catch (err) { next(err); }
  }
}
async function changeCod(req, res, next, delivered) {
  let session, result;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      result = await Order.findById(req.params._id).session(session);
      if (!result || result.paymentMethod !== 'cod' || !(delivered ? ['processing', 'shipped'] : ['pending']).includes(result.status)) fail('Đơn COD không hợp lệ', 409);
      await lockCheckout(result.paymentCode, session);
      result.status = delivered ? 'delivered' : 'processing'; result._statusChangedBy = req.userId;
      if (delivered) result.paymentStatus = 'paid';
      await result.save({ session });
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); } finally { if (session) await session.endSession(); }
}
module.exports = new CheckOutController();
