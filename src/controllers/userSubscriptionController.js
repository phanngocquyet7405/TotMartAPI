const UserSubscription = require("../models/UserSubscription");
const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const {
  processDeliveries,
  checkTodayDeliveries,
} = require("../jobs/deliveryScheduler");
const boxModel = require("../models/Box");
const { paginate } = require("../utils/pagination");

function getPlanConfig(planType) {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const configs = {
    "1_month": {
      intervalMs: THIRTY_DAYS,
      periodMs: THIRTY_DAYS,
      deliveriesCount: 1,
    },
    "3_month": {
      intervalMs: THIRTY_DAYS,
      periodMs: 3 * THIRTY_DAYS,
      deliveriesCount: 3,
    },
    "6_month": {
      intervalMs: THIRTY_DAYS,
      periodMs: 6 * THIRTY_DAYS,
      deliveriesCount: 6,
    },
    "12_month": {
      intervalMs: THIRTY_DAYS,
      periodMs: 12 * THIRTY_DAYS,
      deliveriesCount: 12,
    },
  };
  return configs[planType] || configs["1_month"];
}

class UserSubscriptionController {
  async subscribeToTemplate(req, res, next) {
    try {
      const validated = req.validatedBody;
      const userId = req.userId;

      const template = await SubscriptionTemplate.findById(
        validated.templateId,
      );
      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "Subscription template not found" });
      if (!template.isActive)
        return res.status(400).json({
          success: false,
          message: "This subscription template is no longer available",
        });

      const User = require("../models/User");
      const user = await User.findById(userId);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const subscription = new UserSubscription({
        userId: userId,
        templateId: validated.templateId,
        boxId: template.boxId,
        planType: template.planType,
        shippingAddress: validated.shippingAddress,
      });

      const now = new Date();
      const { intervalMs, periodMs, deliveriesCount } = getPlanConfig(
        template.planType,
      );

      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = new Date(now.getTime() + periodMs);
      subscription.nextDeliveries = new Date(now.getTime() + intervalMs);
      subscription.totalDeliveries = deliveriesCount;
      subscription.remainDeliveries = deliveriesCount;
      subscription.oldPrice = template.basePrice;
      subscription.discountPercent = template.discountPercent;
      subscription.price = template.discountPrice;
      subscription.discount = subscription.oldPrice - subscription.price;

      subscription.gift =
        template.gift && template.gift.length > 0
          ? JSON.parse(JSON.stringify(template.gift))
          : [];

      await subscription.save();

      await subscription.populate("userId", "name email");
      await subscription.populate("templateId", "name planType");
      await subscription.populate("boxId", "name value");
      await subscription.populate("gift.boxId", "name");

      res.status(201).json({
        success: true,
        message: "Subscription created successfully",
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserSubscriptions(req, res, next) {
    try {
      const userId = req.userId;
      const subscriptions = await UserSubscription.find({ userId: userId })
        .populate("templateId", "name planType")
        .populate("boxId", "name value")
        .populate("gift.boxId", "name")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: subscriptions.length,
        data: subscriptions,
      });
    } catch (error) {
      next(error);
    }
  }

  async getSubscriptionById(req, res, next) {
    try {
      const userId = req.userId;
      const subscription = await UserSubscription.findById(req.params.id)
        .populate("userId", "name email")
        .populate("templateId", "name planType")
        .populate("boxId", "name value")
        .populate("gift.boxId", "name");

      if (!subscription)
        return res
          .status(404)
          .json({ success: false, message: "Subscription not found" });
      if (subscription.userId._id.toString() !== userId)
        return res
          .status(403)
          .json({ success: false, message: "You do not have permission" });

      res.status(200).json({ success: true, data: subscription });
    } catch (error) {
      next(error);
    }
  }

  async cancelAtPeriodEnd(req, res, next) {
    try {
      const userId = req.userId;
      const subscription = await UserSubscription.findById(req.params.id);

      if (!subscription)
        return res
          .status(404)
          .json({ success: false, message: "Subscription not found" });
      if (subscription.userId.toString() !== userId)
        return res
          .status(403)
          .json({ success: false, message: "Permission denied" });
      if (subscription.status !== "active")
        return res.status(400).json({
          success: false,
          message: `Cannot cancel: ${subscription.status}`,
        });

      subscription.cancelAtPeriodEnd = true;
      await subscription.save();

      res.status(200).json({
        success: true,
        message: "Subscription cancelled at period end",
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelImmediately(req, res, next) {
    try {
      const userId = req.userId;
      const subscription = await UserSubscription.findById(req.params.id);

      if (!subscription)
        return res
          .status(404)
          .json({ success: false, message: "Subscription not found" });
      if (subscription.userId.toString() !== userId)
        return res
          .status(403)
          .json({ success: false, message: "Permission denied" });
      if (subscription.status !== "active")
        return res.status(400).json({
          success: false,
          message: `Cannot cancel: ${subscription.status}`,
        });

      subscription.status = "cancelled";
      subscription.nextDeliveries = null;
      await subscription.save();

      res.status(200).json({
        success: true,
        message: "Subscription cancelled immediately",
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllSubscriptions(req, res, next) {
    try {
      // [FIX]: Áp dụng phân trang thay vì find()
      const { data, pagination } = await paginate(
        UserSubscription,
        req.query,
        {},
        {
          populate: [
            { path: "userId", select: "name email" },
            { path: "templateId", select: "name" },
            { path: "boxId", select: "name" },
          ],
          sort: { createdAt: -1 },
        },
      );

      res.status(200).json({
        success: true,
        count: data.length,
        data: data,
        pagination: pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async getSubscriptionsByUserId(req, res, next) {
    try {
      const subscriptions = await UserSubscription.find({
        userId: req.params.userId,
      })
        .populate("templateId", "name")
        .populate("boxId", "name")
        .populate("gift.boxId", "name")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: subscriptions.length,
        data: subscriptions,
      });
    } catch (error) {
      next(error);
    }
  }

  async triggerDeliveryProcessing(req, res, next) {
    try {
      await processDeliveries();
      res.status(200).json({
        success: true,
        message: "Delivery processing triggered successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async getTodayDeliveries(req, res, next) {
    try {
      const result = await checkTodayDeliveries(false);

      if (!result.success)
        return res
          .status(500)
          .json({ success: false, message: result.message });

      res.status(200).json({
        success: true,
        message: `${result.count} đơn hàng cần giao hôm nay (${result.date})`,
        date: result.date,
        count: result.count,
        data: result.deliveries,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyTodayDeliveries(req, res, next) {
    try {
      const userId = req.userId;
      const today = new Date();
      const startOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );
      const endOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1,
      );

      const todayDeliveries = await UserSubscription.find({
        userId: userId,
        status: "active",
        nextDeliveries: { $gte: startOfDay, $lt: endOfDay },
      })
        .populate("templateId", "name planType")
        .populate("boxId", "name value")
        .populate("gift.boxId", "name");

      res.status(200).json({
        success: true,
        message: `Bạn có ${todayDeliveries.length} đơn hàng cần giao hôm nay`,
        count: todayDeliveries.length,
        data: todayDeliveries,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserSubscriptionController();
