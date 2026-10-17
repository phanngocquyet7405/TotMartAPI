const reconciliation = require('../services/paymentReconciliationService');
const { pinBox } = require("../services/boxDefinitionService");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Subscription = require("../models/UserSubscription");
const Template = require("../models/SubscriptionTemplate");
const Checkout = require("../models/Checkout");
const Fulfillment = require("../models/SubscriptionFulfillment");
const { fail } = require("../services/pricingService");
const {
  paymentCode,
  requestHash,
  replay,
  lockCheckout,
} = require("../services/checkoutLifecycle");
const {
  planMonths,
  prepaidPrice,
  addMonths,
  transitionFulfillment,
} = require("../services/subscriptionService");
const {
  processDeliveries,
  checkTodayDeliveries,
} = require("../jobs/deliveryScheduler");
const config = require("../config/environment");
const populate = (query) =>
  query
    .populate("userId", "name email")
    .populate("templateId", "name planType")
    .populate("boxId", "name value")
    .populate("gift.boxId", "name");
class UserSubscriptionController {
  async subscribeToTemplate(req, res, next) {
    let session, key, hash, result;
    try {
      key = require("../utils/idempotencyKey")(req);
      hash = requestHash(req.validatedBody);
      const previous = await replay(req.userId, key, hash);
      if (previous)
        return res.status(201).json({ success: true, data: previous.result });
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const previous = await replay(req.userId, key, hash, session);
        if (previous) {
          result = previous.result;
          return;
        }
        const template = await Template.findById(
          req.validatedBody.templateId,
        ).session(session);
        if (!template?.isActive) fail("Gói không còn được bán", 404);
        // Acquire all Box guards in stable order, including gifts, before creating the subscription.
        const roles = new Map([[String(template.boxId), "main"]]);
        for (const gift of template.gift) {
          if (!Number.isSafeInteger(gift.quantity) || gift.quantity < 1)
            fail("Số lượng hộp quà không hợp lệ", 400);
          if (String(gift.boxId) === String(template.boxId))
            fail("Hộp chính không thể đồng thời là quà", 400);
          roles.set(String(gift.boxId), "gift");
        }
        const pins = new Map();
        for (const id of [...roles.keys()].sort())
          pins.set(id, await pinBox(id, session, { kind: roles.get(id) }));
        const mainPin = pins.get(String(template.boxId));
        const box = mainPin.version.definition;
        if (!box || box.isGift) fail("Hộp của gói không còn hợp lệ", 409);
        const pricing = prepaidPrice(
          box.value,
          template.planType,
          template.discountPercent,
        );
        const price = pricing.discountPrice;
        if (
          req.validatedBody.expectedTotalAmount !== undefined &&
          req.validatedBody.expectedTotalAmount !== price
        )
          fail(
            "Giá gói đã thay đổi. Vui lòng tải lại và kiểm tra tổng tiền trước khi đăng ký.",
            409,
          );
        if (!Number.isSafeInteger(price) || price <= 0)
          fail("Gói trả trước cần giá VND lớn hơn 0");
        const months = planMonths(template.planType),
          now = new Date(),
          code = paymentCode();
        const [sub] = await Subscription.create(
          [
            {
              userId: req.userId,
              templateId: template._id,
              boxId: template.boxId,
              planType: template.planType,
              boxVersionId: mainPin.version._id,
              snapshotOrigin: "pinned_at_purchase",
              shippingAddress: req.validatedBody.shippingAddress,
              shippingPayment: 'customer_to_carrier',
              paymentCode: code,
              status: "pending_payment",
              paymentStatus: "pending",
              nextDeliveries: null,
              currentPeriodStart: now,
              currentPeriodEnd: addMonths(now, months),
              totalDeliveries: months,
              remainDeliveries: months,
              oldPrice: pricing.basePrice,
              price,
              discountPercent: template.discountPercent,
              discount: pricing.basePrice - price,
              gift: template.gift.map((g) => ({
                boxId: g.boxId,
                versionId: pins.get(String(g.boxId)).version._id,
                quantity: g.quantity,
              })),
            },
          ],
          { session },
        );
        result = { ...sub.toObject(), orderCode: code, totalAmount: price };
        await Checkout.create(
          [
            {
              userId: req.userId,
              requestKey: key,
              requestHash: hash,
              paymentCode: code,
              kind: "subscription",
              shippingPayment: 'customer_to_carrier',
              subscriptionId: sub._id,
              totalAmount: price,
              paymentMethod: "online",
              expiresAt: new Date(
                Date.now() + config.orderExpiryHours * 3600000,
              ),
              result,
            },
          ],
          { session },
        );
      });
      res.status(201).json({
        success: true,
        message:
          "Gói chờ thanh toán; mỗi tháng giao một lượt sau khi kích hoạt",
        data: result,
      });
    } catch (err) {
      if (err.code === 11000 && key) {
        try {
          const previous = await replay(req.userId, key, hash);
          if (previous)
            return res
              .status(201)
              .json({ success: true, data: previous.result });
        } catch (e) {
          return next(e);
        }
      }
      next(err);
    } finally {
      if (session) await session.endSession();
    }
  }
  async getUserSubscriptions(req, res, next) {
    try {
      const data = await populate(
        Subscription.find({ userId: req.userId }),
      ).sort({ createdAt: -1 });
      res.json({ success: true, data, count: data.length });
    } catch (err) {
      next(err);
    }
  }
  async getSubscriptionById(req, res, next) {
    try {
      const data = await populate(
        Subscription.findOne({ _id: req.params.id, userId: req.userId }),
      );
      if (!data) fail("Không tìm thấy gói", 404);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async cancelAtPeriodEnd(req, res, next) {
    try {
      const data = await Subscription.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId, status: "active" },
        { cancelAtPeriodEnd: true },
        { new: true },
      );
      if (!data) fail("Gói không hoạt động", 409);
      res.json({
        success: true,
        message:
          "Gói trả trước tiếp tục giao đủ số lượt; không gia hạn tự động",
        data,
      });
    } catch (err) {
      next(err);
    }
  }
  async cancelImmediately(req, res, next) {
    let session, sub;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        sub = await Subscription.findOne({
          _id: req.params.id,
          userId: req.userId,
        }).session(session);
        if (!sub) fail("Không tìm thấy gói", 404);
        if (sub.status === "cancelled") return;
        if (!["active", "pending_payment"].includes(sub.status))
          fail("Gói không thể hủy", 409);
        const checkout = await lockCheckout(sub.paymentCode, session);
        if (
          await Fulfillment.exists({
            subscriptionId: sub._id,
            state: "dispatched",
          }).session(session)
        )
          fail("Có lượt đang giao; hoàn tất giao trước khi hủy", 409);
        if (sub.paymentStatus === "paid") {
          sub.refundStatus = "pending";
          sub.refundAmount =
            Math.floor(
              (sub.price * sub.remainDeliveries) / sub.totalDeliveries,
            ) + (checkout?.paymentLedgerVersion === 2 ? 0 : (checkout?.overpaidAmount || 0));
        }
        if (sub.paymentStatus === 'paid' && sub.refundAmount > 0) {
          await reconciliation.queueRefund({ key: `subscription:${sub._id}`, checkoutId: checkout?._id,
            subscriptionId: sub._id, purpose: 'subscription', amount: sub.refundAmount,
            reason: 'Hủy phần chưa giao của subscription trả trước' }, session, req.userId);
        } else if (sub.paymentStatus !== 'paid') {
          await reconciliation.queueUnpaidRefund(checkout, session, 'Hủy subscription đã nhận tiền thiếu', req.userId);
        }
        sub.status = "cancelled";
        sub.nextDeliveries = null;
        await sub.save({ session });
        await Fulfillment.updateMany(
          { subscriptionId: sub._id, state: "pending" },
          { state: "cancelled" },
          { session },
        );
        if (checkout) {
          checkout.state = "cancelled";
          await checkout.save({ session });
        }
      });
      res.json({
        success: true,
        message: "Đã hủy; phần tiền chưa dùng chờ đối soát hoàn tiền",
        data: sub,
      });
    } catch (err) {
      next(err);
    } finally {
      if (session) await session.endSession();
    }
  }
  async getAllSubscriptions(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1),
        limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
      const [data, total] = await Promise.all([
        populate(Subscription.find())
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Subscription.countDocuments(),
      ]);
      res.json({
        success: true,
        data,
        count: data.length,
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
  async getSubscriptionsByUserId(req, res, next) {
    try {
      const data = await populate(
        Subscription.find({ userId: req.params.userId }),
      ).sort({ createdAt: -1 });
      res.json({ success: true, data, count: data.length });
    } catch (err) {
      next(err);
    }
  }
  async triggerDeliveryProcessing(req, res, next) {
    try {
      await processDeliveries();
      res.json({
        success: true,
        message: "Đã tạo yêu cầu giao đến hạn; chưa ghi nhận đã giao",
      });
    } catch (err) {
      next(err);
    }
  }
  async getTodayDeliveries(req, res, next) {
    try {
      const result = await checkTodayDeliveries(false);
      res.json({ ...result, data: result.deliveries });
    } catch (err) {
      next(err);
    }
  }
  async getMyTodayDeliveries(req, res, next) {
    try {
      const result = await checkTodayDeliveries(false, req.userId);
      res.json({ success: true, data: result.deliveries, count: result.count });
    } catch (err) {
      next(err);
    }
  }
  async dispatchFulfillment(req, res, next) {
    try {
      const data = await transitionFulfillment(
        req.params._id,
        req.userId,
        false,
        req.validatedBody.trackingReference,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async deliverFulfillment(req, res, next) {
    try {
      const data = await transitionFulfillment(
        req.params._id,
        req.userId,
        true,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async pendingRefunds(req, res, next) {
    try {
      const data = await populate(
        Subscription.find({ refundStatus: "pending" }),
      ).limit(100);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async completeRefund(req, res, next) {
    return next(Object.assign(new Error('Dùng API reconciliation hoàn tiền có audit'), { statusCode: 409 }));
  }

}
module.exports = new UserSubscriptionController();
