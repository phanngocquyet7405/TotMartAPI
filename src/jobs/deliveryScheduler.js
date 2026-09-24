const cron = require("node-cron");
const UserSubscription = require("../models/UserSubscription");
const logger = require("../utils/logger");

let isProcessingDeliveries = false;
async function processDeliveries() {
  if (isProcessingDeliveries) {
    logger.debug(
      "[DeliveryScheduler] Tiến trình trước đang chạy, bỏ qua lượt này để tránh trùng lặp.",
    );
    return;
  }

  isProcessingDeliveries = true;

  try {
    const now = new Date();

    const duePlans = await UserSubscription.find({
      status: "active",
      nextDeliveries: { $lte: now },
    });

    if (duePlans.length === 0) {
      return;
    }

    logger.info(
      { count: duePlans.length },
      "[DeliveryScheduler] Tìm thấy gói đến hạn giao hàng",
    );

    for (const subscription of duePlans) {
      try {
        subscription.lastDeliveries = subscription.nextDeliveries;
        subscription.completeDeliveries += 1;
        subscription.remainDeliveries -= 1;

        if (subscription.remainDeliveries <= 0) {
          subscription.remainDeliveries = 0;
          subscription.status = "expired";
          subscription.nextDeliveries = null;
          logger.info(
            { subscriptionId: subscription._id },
            "[DeliveryScheduler] Subscription đã hết lượt giao → expired",
          );
        } else if (
          subscription.cancelAtPeriodEnd &&
          now >= subscription.currentPeriodEnd
        ) {
          subscription.status = "cancelled";
          subscription.nextDeliveries = null;
          logger.info(
            { subscriptionId: subscription._id },
            "[DeliveryScheduler] Subscription đã hủy cuối kỳ → cancelled",
          );
        } else {
          const intervalMonths = {
            "1_month": 1,
            "3_month": 3,
            "6_month": 6,
            "12_month": 12,
          };
          const addMonths = intervalMonths[subscription.planType] || 1;

          let nextDate = new Date(subscription.lastDeliveries);
          nextDate.setMonth(nextDate.getMonth() + addMonths);

          subscription.nextDeliveries = nextDate;
          logger.info(
            {
              subscriptionId: subscription._id,
              nextDeliveries: subscription.nextDeliveries,
            },
            "[DeliveryScheduler] Subscription cập nhật nextDeliveries",
          );
        }

        await subscription.save();
      } catch (err) {
        logger.error(
          { err, subscriptionId: subscription._id },
          "[DeliveryScheduler] Lỗi xử lý subscription",
        );
      }
    }

    logger.info(
      { count: duePlans.length },
      "[DeliveryScheduler] Hoàn tất xử lý",
    );
  } catch (error) {
    logger.error(
      { err: error },
      "[DeliveryScheduler] Lỗi khi xử lý deliveries",
    );
  } finally {
    isProcessingDeliveries = false;
  }
}

async function checkTodayDeliveries(shouldLog = true) {
  try {
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
      status: "active",
      nextDeliveries: {
        $gte: startOfDay,
        $lt: endOfDay,
      },
    })
      .populate("userId", "name email phone")
      .populate("templateId", "name planType")
      .populate("boxId", "name value")
      .populate("gift.boxId", "name");

    const result = {
      success: true,
      date: startOfDay.toISOString().split("T")[0],
      count: todayDeliveries.length,
      deliveries: todayDeliveries,
    };

    if (shouldLog) {
      if (todayDeliveries.length > 0) {
        logger.info(
          {
            date: result.date,
            deliveries: todayDeliveries.map((sub) => ({
              customer: sub.userId?.name,
              phone: sub.userId?.phone || "N/A",
              email: sub.userId?.email,
              box: sub.boxId?.name,
              address: `${sub.shippingAddress.address}, ${sub.shippingAddress.district}, ${sub.shippingAddress.city}`,
            })),
          },
          `[DeliveryScheduler] Hôm nay có ${todayDeliveries.length} đơn cần giao`,
        );
      } else {
        logger.info(
          { date: result.date },
          "[CheckDeliveries] Hôm nay không có đơn nào cần giao",
        );
      }
    }

    return result;
  } catch (error) {
    logger.error({ err: error }, "[CheckTodayDeliveries] Lỗi");
    return {
      success: false,
      message: error.message,
    };
  }
}

function startDeliveryScheduler() {
  logger.info("[DeliveryScheduler] Đã khởi động - chạy mỗi 15 phút");

  processDeliveries();
  checkTodayDeliveries(true);

  cron.schedule("*/15 * * * *", () => {
    logger.debug("[DeliveryScheduler] Đang chạy kiểm tra...");
    processDeliveries();
  });

  cron.schedule("0 6 * * *", () => {
    logger.debug("[CheckDeliveries] Đang kiểm tra đơn cần giao hôm nay...");
    checkTodayDeliveries(true);
  });
}

module.exports = {
  startDeliveryScheduler,
  processDeliveries,
  checkTodayDeliveries,
};
