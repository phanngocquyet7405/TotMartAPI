const cron = require("node-cron");
const UserSubscription = require("../models/UserSubscription");

let isProcessingDeliveries = false;
async function processDeliveries() {
  if (isProcessingDeliveries) {
    console.log(
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

    console.log(
      `[DeliveryScheduler] Tìm thấy ${duePlans.length} gói đến hạn giao hàng`,
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
          console.log(
            `[DeliveryScheduler] Subscription ${subscription._id} đã hết lượt giao → expired`,
          );
        } else if (
          subscription.cancelAtPeriodEnd &&
          now >= subscription.currentPeriodEnd
        ) {
          subscription.status = "cancelled";
          subscription.nextDeliveries = null;
          console.log(
            `[DeliveryScheduler] Subscription ${subscription._id} đã hủy cuối kỳ → cancelled`,
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
          console.log(
            `[DeliveryScheduler] Subscription ${subscription._id} → nextDeliveries: ${subscription.nextDeliveries.toISOString()}`,
          );
        }

        await subscription.save();
      } catch (err) {
        console.error(
          `[DeliveryScheduler] Lỗi xử lý subscription ${subscription._id}:`,
          err.message,
        );
      }
    }

    console.log(`[DeliveryScheduler] Hoàn tất xử lý ${duePlans.length} gói`);
  } catch (error) {
    console.error(
      "[DeliveryScheduler] Lỗi khi xử lý deliveries:",
      error.message,
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
        console.log(
          `\n╔════════════════════════════════════════════════════════════╗`,
        );
        console.log(
          `║ [THÔNG BÁO GẬP] Hôm nay (${result.date}) có ${todayDeliveries.length} đơn cần giao`,
        );
        console.log(
          `╠════════════════════════════════════════════════════════════╣`,
        );

        todayDeliveries.forEach((sub, index) => {
          console.log(
            `║ ${index + 1}. Khách: ${sub.userId.name} | Box: ${sub.boxId.name}`,
          );
          console.log(
            `║    SĐT: ${sub.userId.phone || "N/A"} | Email: ${sub.userId.email}`,
          );
          console.log(
            `║    Địa chỉ: ${sub.shippingAddress.address}, ${sub.shippingAddress.district}, ${sub.shippingAddress.city}`,
          );
        });

        console.log(
          `╚════════════════════════════════════════════════════════════╝\n`,
        );
      } else {
        console.log(
          `[CheckDeliveries] Hôm nay (${result.date}) không có đơn nào cần giao`,
        );
      }
    }

    return result;
  } catch (error) {
    console.error("[CheckTodayDeliveries] Lỗi:", error.message);
    return {
      success: false,
      message: error.message,
    };
  }
}

function startDeliveryScheduler() {
  console.log("[DeliveryScheduler] Đã khởi động - chạy mỗi 15 phút");

  processDeliveries();
  checkTodayDeliveries(true);

  cron.schedule("*/15 * * * *", () => {
    console.log(
      `[DeliveryScheduler] Đang chạy kiểm tra... ${new Date().toISOString()}`,
    );
    processDeliveries();
  });

  cron.schedule("0 6 * * *", () => {
    console.log(
      `[CheckDeliveries] Đang kiểm tra đơn cần giao hôm nay... ${new Date().toISOString()}`,
    );
    checkTodayDeliveries(true);
  });
}

module.exports = {
  startDeliveryScheduler,
  processDeliveries,
  checkTodayDeliveries,
};
