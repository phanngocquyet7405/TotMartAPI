const cron = require("node-cron");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const config = require("../config/environment");

const EXPIRY_HOURS = config.orderExpiryHours;

let isProcessingExpiry = false;

async function expireStaleOrders() {
  if (isProcessingExpiry) return;
  isProcessingExpiry = true;

  try {
    const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000);

    const staleOrders = await Order.find({
      paymentMethod: "online",
      paymentStatus: "pending",
      status: "pending",
      createdAt: { $lt: cutoff },
    });

    if (staleOrders.length === 0) return;

    console.log(
      `[OrderExpiryScheduler] Tìm thấy ${staleOrders.length} đơn online quá hạn thanh toán`,
    );

    for (const order of staleOrders) {
      try {
        if (order.couponCode) {
          const restored = await Coupon.findOneAndUpdate(
            { code: order.couponCode, usedCount: { $gt: 0 } },
            { $inc: { usedCount: -1 } },
            { new: true },
          );
          if (restored) {
            console.log(
              `[OrderExpiryScheduler] Đã hoàn lại 1 lượt dùng cho coupon: ${order.couponCode}`,
            );
          }
        }

        order.status = "cancelled";
        order.cancelReason = `Tự động huỷ - quá ${EXPIRY_HOURS}h không thanh toán`;
        order.cancelledBy = null;
        order._statusChangeNote = "Huỷ tự động bởi orderExpiryScheduler";
        await order.save();
      } catch (err) {
        console.error(
          `[OrderExpiryScheduler] Lỗi huỷ đơn ${order.orderId}:`,
          err.message,
        );
      }
    }
  } catch (error) {
    console.error("[OrderExpiryScheduler] Lỗi:", error.message);
  } finally {
    isProcessingExpiry = false;
  }
}

function startOrderExpiryScheduler() {
  console.log(
    `[OrderExpiryScheduler] Đã khởi động - chạy mỗi giờ, ngưỡng ${EXPIRY_HOURS}h`,
  );

  expireStaleOrders();

  cron.schedule("0 * * * *", () => {
    console.log(
      `[OrderExpiryScheduler] Đang kiểm tra đơn quá hạn... ${new Date().toISOString()}`,
    );
    expireStaleOrders();
  });
}

module.exports = { startOrderExpiryScheduler, expireStaleOrders };
