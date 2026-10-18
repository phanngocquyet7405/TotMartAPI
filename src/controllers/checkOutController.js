const attempts = require('../services/checkoutAttemptService');
const reconciliation = require('../services/paymentReconciliationService');
const { deliverySnapshot } = require("../services/deliverySnapshot");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Checkout = require("../models/Checkout");
const PaymentEvent = require("../models/PaymentEvent");
const Subscription = require("../models/UserSubscription");
const { buildQuote, allocate, fail } = require("../services/pricingService");
const {
  deductStock,
  restoreStock,
  reserveOrder,
} = require("../services/inventoryService");
const {
  requestHash,
  paymentCode,
  lockCheckout,
  replay,
  releaseCoupon,
  qrUrl,
} = require("../services/checkoutLifecycle");
const { enqueue, drain } = require("../jobs/notificationOutboxScheduler");
const { activateSubscription } = require("../services/subscriptionService");
const config = require("../config/environment");
const logger = require("../utils/logger");

const requestKey = require('../utils/idempotencyKey');
const flush = () =>
  drain().catch((err) => logger.error({ err }, "Outbox delivery deferred"));
class CheckOutController {
  async quote(req, res, next) {
    try {
      const { items, couponCode } = req.validatedBody;
      const quote = await buildQuote(items, couponCode);
      const { products, boxes, ...data } = quote;
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async checkOut(req, res, next) {
    let session, key, hash, result;
    try {
      key = requestKey(req);
      hash = requestHash(req.validatedBody);
      const previous = await replay(req.userId, key, hash, null, 'products');
      if (previous)
        return res.status(201).json({ success: true, data: previous.result });
      await attempts.prepare(req.userId, 'products', key, hash, req.validatedBody);
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const attempt = await attempts.lock(req.userId, 'products', key, hash, session);
        const existing = await replay(req.userId, key, hash, session, 'products');
        if (existing) {
          result = existing.result;
          return;
        }
        const { addressId, paymentMethod, note, couponCode, quoteFingerprint } =
          req.validatedBody;
        const user = await User.findById(req.userId).session(session);
        const shippingAddress = attempt.address;
        const cart = await Cart.findOne({
          userId: req.userId,
          isSubscribeCart: false,
        }).session(session);
        const quote = await buildQuote(cart?.items, couponCode, session, true);
        if (quoteFingerprint && quoteFingerprint !== quote.fingerprint)
          fail(
            "Giá hoặc giỏ hàng đã thay đổi. Vui lòng kiểm tra lại báo giá.",
            409,
          );
        if (paymentMethod === "online" && quote.totalAmount <= 0)
          fail("Thanh toán online cần số tiền lớn hơn 0");
        const grouped = new Map();
        for (const p of quote.products) {
          const id = String(p.merchantId);
          if (!grouped.has(id)) grouped.set(id, []);
          grouped.get(id).push(p);
        }
        const groups = [...grouped.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        );
        const discounts = allocate(
          quote.discountAmount,
          groups.map(([, products]) =>
            products.reduce((sum, p) => sum + p.totalPrice, 0),
          ),
        );
        const code = paymentCode(),
          created = [];
        for (const [index, [merchantId, products]] of groups.entries()) {
          const subtotal = products.reduce((sum, p) => sum + p.totalPrice, 0);
          const shippingFee = index === 0 ? quote.shippingFee : 0;
          const boxes = index === 0 ? quote.boxes : [];
          const giftFee = products.reduce((sum, p) => sum + p.giftFee, 0);
          const bulkDiscountAmount = products.reduce((sum, p) => sum + p.bulkDiscountAmount, 0);
          const [order] = await Order.create(
            [
              {
                userId: req.userId,
                merchantId,
                paymentCode: code,
                customerEmail: user.email,
                products,
                boxes,
                orderId:
                  "ORD" + crypto.randomBytes(12).toString("hex").toUpperCase(),
                totalAmount: subtotal - discounts[index] + shippingFee + giftFee,
                giftFee, bulkDiscountAmount, pricingPolicyVersion: quote.policyVersion,
                shippingFee,
                shippingPayment: quote.shippingPayment,
                shippingMode: quote.shippingMode,
                discountAmount: discounts[index],
                couponCode: quote.couponCode,
                shippingAddress,
                paymentMethod,
                note,
                stockDeducted: paymentMethod === "cod",
              },
            ],
            { session },
          );
          if (paymentMethod === "cod") {
            await deductStock(products, session, boxes);
            await enqueue(order, "new_order", session);
          }
          created.push(order);
        }
        result = {
          orderId: String(created[0]._id),
          orderCode: code,
          totalAmount: quote.totalAmount,
          shippingPayment: quote.shippingPayment,
        };
        await Checkout.create(
          [
            {
              userId: req.userId,
              requestKey: key,
              requestHash: hash,
              paymentCode: code,
              orderIds: created.map((o) => o._id),
              totalAmount: quote.totalAmount,
              shippingPayment: quote.shippingPayment,
              paymentMethod,
              expiresAt: new Date(
                Date.now() + config.orderExpiryHours * 3600000,
              ),
              couponCode: quote.couponCode,
              result,
            },
          ],
          { session },
        );
        await attempts.complete(req.userId, 'products', key, result, session);
        await Cart.deleteOne({ _id: cart._id }, { session });
      });
      res.status(201).json({ success: true, data: result });
      void flush();
    } catch (err) {
      if (err.code === 11000 && key) {
        try {
          const previous = await replay(req.userId, key, hash, null, 'products');
          if (previous)
            return res
              .status(201)
              .json({ success: true, data: previous.result });
        } catch (replayError) {
          return next(replayError);
        }
      }
      if (key && hash) await attempts.reject(req.userId, 'products', key, hash, err).catch(() => {});
      next(err);
    } finally {
      if (session) await session.endSession();
    }
  }
  async sepayWebhook(req, res, next) {
    try {
      const result = await reconciliation.receiveWebhook(req.validatedBody);
      res.status(200).json({ success: true,
        message: result.replayed ? 'Payment already processed' : 'Receipt accepted', data: result });
      void flush();
    } catch (err) { next(err); }
  }
  async getOrderStatus(req, res, next) {
    try {
      const checkout = await Checkout.findOne({
        paymentCode: req.params.paymentCode,
      });
      const orders = await Order.find({
        paymentCode: req.params.paymentCode,
      }).select(
        "orderId userId status paymentStatus totalAmount paymentMethod",
      );
      if (!checkout && !orders.length) fail("Không tìm thấy đơn hàng", 404);
      if (
        req.user.role !== "admin" &&
        String(checkout?.userId || orders[0].userId) !== req.userId
      )
        fail("Không có quyền xem đơn hàng này", 403);
      const paid =
        checkout?.state === "paid" ||
        (orders.length > 0 && orders.every((o) => o.paymentStatus === "paid"));
      const online = (checkout?.paymentMethod || orders[0]?.paymentMethod) === 'online';
      const invalid =
        checkout?.state === "cancelled" ||
        (online && checkout?.expiresAt <= new Date() && !paid) ||
        orders.some((o) => ["cancelled", "returned"].includes(o.status));

      const payable =
        checkout?.paymentLedgerVersion === 2 &&
        online &&
        !paid &&
        !invalid &&
        orders.every(
          (o) => o.status === "pending" && o.paymentStatus === "pending",
        );
      const totalAmount =
        checkout?.totalAmount ??
        orders.reduce((sum, o) => sum + o.totalAmount, 0);
      const receivedAmount = checkout?.paymentLedgerVersion === 2 ? checkout.receivedAmount : (paid ? totalAmount : 0);
      const remainingAmount = Math.max(0, totalAmount - receivedAmount);
      const data = {
        receivedAmount, remainingAmount,
        paymentStatus: paid ? "paid" : invalid ? "cancelled" : "pending",
        payable,
        totalAmount,
        shippingPayment: checkout?.shippingPayment || 'platform',
        shippingMode: checkout?.shippingPayment === 'customer_to_carrier' ? 'separate' : 'legacy_fixed',
        expiresAt: checkout?.expiresAt,
        kind: checkout?.kind || "products",
        orders: orders.map((o) => ({
          orderId: o.orderId,
          status: o.status,
          paymentStatus: o.paymentStatus,
          totalAmount: o.totalAmount,
        })),
      };
      if (payable && remainingAmount > 0) data.qrUrl = qrUrl(req.params.paymentCode, remainingAmount);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async confirmCodOrder(req, res, next) {
    return changeCod(req, res, next, false);
  }
  async markCodDelivered(req, res, next) {
    return changeCod(req, res, next, true);
  }
  async cancelOrder(req, res, next) {
    let session, cancelled;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const target = await Order.findById(req.params._id).session(session);
        if (!target) fail("Đơn hàng không tồn tại", 404);
        if (req.user.role !== "admin" && String(target.userId) !== req.userId)
          fail("Không có quyền huỷ đơn hàng này", 403);
        if (!["pending", "processing", "on_hold"].includes(target.status))
          fail("Đơn không thể hủy ở trạng thái hiện tại");
        const checkout = await lockCheckout(target.paymentCode, session);
        const siblings = await Order.find({
          paymentCode: target.paymentCode,
        }).session(session);
        const groupCancel =
          (target.paymentMethod === "online" &&
            target.paymentStatus !== "paid") ||
          siblings.some((o) => o.boxes?.length);
        const targets = groupCancel
          ? siblings.filter((o) => o.status !== "cancelled")
          : [target];
        if (
          targets.some(
            (o) => !["pending", "processing", "on_hold"].includes(o.status),
          )
        )
          fail("Một phần đơn đã giao; cần xử lý hoàn/trả riêng", 409);
        for (const order of targets) {
          if (order.stockDeducted) {
            await restoreStock(order.products, session, order.boxes);
            order.stockDeducted = false;
          }
          if (order.paymentStatus === "paid") {
            order.refundStatus = "pending";
            order.refundAmount =
              order.totalAmount + (checkout?.paymentLedgerVersion === 2 ? 0 : (order.overpaidAmount || 0));
            if (order.refundAmount > 0) await reconciliation.queueRefund({ key: `order:${order._id}`, checkoutId: checkout?._id,
              orderId: order._id, purpose: 'order', amount: order.refundAmount,
              reason: 'Hủy đơn đã thanh toán' }, session, req.userId);
            else order.refundStatus = 'not_applicable';
          }
          order._statusChangedBy = req.userId;
          order.cancelReason =
            req.validatedBody?.reason || req.body?.reason || "Không có lý do";
          order.cancelledBy = req.userId;
          order.status = "cancelled";
          await order.save({ session });
          await enqueue(order, "order_cancelled", session);
        }
        // The target fetched before locking is a different document instance.
        const allCancelled = siblings.every(
          (o) =>
            targets.some((t) => String(t._id) === String(o._id)) ||
            o.status === "cancelled",
        );
        if (checkout && allCancelled && checkout.state !== 'paid') {
          await reconciliation.queueUnpaidRefund(checkout, session, 'Hủy checkout đã nhận tiền thiếu', req.userId);
        }
        await releaseCoupon(checkout, session);
        if (checkout && allCancelled) {
          checkout.state = "cancelled";
          await checkout.save({ session });
        }
        cancelled =
          targets.find((o) => String(o._id) === String(target._id)) || target;
      });
      res.json({ success: true, message: "Đã hủy đơn hàng", data: cancelled });
      void flush();
    } catch (err) {
      next(err);
    } finally {
      if (session) await session.endSession();
    }
  }
  async resolveInventoryHold(req, res, next) {
    let session, order;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        order = await Order.findOne({
          _id: req.params._id,
          status: "on_hold",
          paymentStatus: "paid",
          stockDeducted: false,
        }).session(session);
        if (!order) fail("Đơn không cần xử lý thiếu hàng", 409);
        await lockCheckout(order.paymentCode, session);
        const siblings = await Order.find({
          paymentCode: order.paymentCode,
        }).session(session);
        const targets = siblings.some((o) => o.boxes?.length)
          ? siblings
          : [order];
        if (
          targets.some(
            (o) =>
              o.status !== "on_hold" ||
              o.paymentStatus !== "paid" ||
              o.stockDeducted,
          )
        )
          fail("Nhóm hộp không ở trạng thái có thể giữ kho", 409);
        for (const target of targets) {
          await deductStock(target.products, session, target.boxes);
          target.stockDeducted = true;
          target.status = "processing";
          target._statusChangedBy = req.userId;
          await target.save({ session });
        }
        order = targets.find((o) => String(o._id) === String(req.params._id));
      });
      res.json({ success: true, data: order });
    } catch (err) {
      next(err);
    } finally {
      if (session) await session.endSession();
    }
  }
  async getPendingRefunds(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1),
        limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
      const [data, total] = await Promise.all([
        Order.find({ refundStatus: "pending" })
          .sort({ cancelledAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Order.countDocuments({ refundStatus: "pending" }),
      ]);
      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
  async completeRefund(req, res, next) {
    // Old endpoint must not bypass the audited workflow.
    return next(Object.assign(new Error('Dùng /api/admin/reconciliation/refunds/:id/complete kèm bằng chứng chuyển tiền'), { statusCode: 409 }));
  }
  async listPaymentEvents(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1),
        limit = 50;
      const filter = req.query.state
        ? { state: req.query.state }
        : { state: { $ne: "processed" } };
      const [data, total] = await Promise.all([
        PaymentEvent.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        PaymentEvent.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
async function changeCod(req, res, next, delivered) {
  let session, result;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      result = await Order.findById(req.params._id).session(session);
      if (
        !result ||
        result.paymentMethod !== "cod" ||
        !(delivered ? ["processing", "shipped", "delivered"] : ["pending"]).includes(
          result.status,
        )
      )
        fail("Đơn COD không hợp lệ", 409);
      if (delivered && result.paymentStatus === 'paid') return;
      await lockCheckout(result.paymentCode, session);
      result.status = delivered ? "delivered" : "processing";
      result._statusChangedBy = req.userId;
      if (delivered) {
        result.paymentStatus = "paid";
        result.codCollectionStatus = "confirmed";
        // Delivery may already have been reported by the merchant. Preserve the operational history,
        // and record the separate admin settlement even if status no longer changes.
        if (!result.isModified('status')) result.statusHistory.push({ status: 'delivered', changedBy: req.userId,
          note: 'Admin xác nhận đã thu và đối soát tiền COD' });
      }
      await result.save({ session });
      if (delivered) {
        const checkout = await Checkout.findOne({ paymentCode: result.paymentCode }).session(session);
        if (checkout) {
          const siblings = await Order.find({ paymentCode: result.paymentCode }).session(session);
          const settled = siblings.filter(o => o.paymentStatus === 'paid');
          checkout.receivedAmount = settled.reduce((sum, o) => sum + o.totalAmount, 0);
          await Checkout.updateOne({ _id: checkout._id }, { $set: {
            receivedAmount: checkout.receivedAmount,
            state: settled.length === siblings.length ? 'paid' : checkout.state,
          } }, { session, runValidators: true });
        }
      }
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  } finally {
    if (session) await session.endSession();
  }
}
module.exports = new CheckOutController();
