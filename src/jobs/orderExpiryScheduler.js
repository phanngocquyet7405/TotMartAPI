const cron = require("node-cron");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const config = require("../config/environment");
const logger = require("../utils/logger");

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

    logger.info(
      { count: staleOrders.length },
      "[OrderExpiryScheduler] Tìm thấy đơn online quá hạn thanh toán",
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
            logger.info(
              { couponCode: order.couponCode },
              "[OrderExpiryScheduler] Đã hoàn lại 1 lượt dùng cho coupon",
            );
          }
        }

        order.status = "cancelled";
        order.cancelReason = `Tự động huỷ - quá ${EXPIRY_HOURS}h không thanh toán`;
        order.cancelledBy = null;
        order._statusChangeNote = "Huỷ tự động bởi orderExpiryScheduler";
        await order.save();
      } catch (err) {
        logger.error(
          { err, orderId: order.orderId },
          "[OrderExpiryScheduler] Lỗi huỷ đơn",
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[OrderExpiryScheduler] Lỗi");
  } finally {
    isProcessingExpiry = false;
  }
}

function startOrderExpiryScheduler() {
  logger.info(
    { expiryHours: EXPIRY_HOURS },
    "[OrderExpiryScheduler] Đã khởi động - chạy mỗi giờ",
  );

  expireStaleOrders();

  cron.schedule("0 * * * *", () => {
    logger.debug("[OrderExpiryScheduler] Đang kiểm tra đơn quá hạn...");
    expireStaleOrders();
  });
}

module.exports = { startOrderExpiryScheduler, expireStaleOrders };
