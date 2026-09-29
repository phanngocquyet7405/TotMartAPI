const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Product = require("../models/Product");
const Coupon = require("../models/Coupon");
const { notifyMerchant } = require("../utils/notify");
const logger = require("../utils/logger");

function buildQrUrl(orderId, amount) {
  const acc = process.env.SEPAY_BANK_ACCOUNT;
  const bank = process.env.SEPAY_BANK_NAME;
  return `https://qr.sepay.vn/img?acc=${acc}&bank=${bank}&amount=${amount}&des=${orderId}`;
}

// Build mảng products cho Order từ Cart hiện tại
async function buildOrderProductsFromCart(cart, session) {
  const products = [];
  for (const item of cart.items) {
    if (!item.productId) continue;

    const product = await Product.findById(item.productId)
      .populate("brand")
      .session(session);

    if (!product) {
      const err = new Error("Một sản phẩm trong giỏ hàng không còn tồn tại");
      err.statusCode = 400;
      throw err;
    }
    if (!product.brand?.ownerId) {
      const err = new Error("Product has no valid Brand/merchant");
      err.statusCode = 400;
      throw err;
    }
    if (product.instock === false || product.stock < item.quantity) {
      const err = new Error(`${product.name} không đủ hàng`);
      err.statusCode = 400;
      throw err;
    }

    const unitPrice =
      product.salePercent > 0
        ? Math.round(product.price * (1 - product.salePercent / 100))
        : product.price;

    products.push({
      productId: product._id,
      name: product.name,
      unitPrice,
      quantity: item.quantity,
      brand: product.brand._id,
      totalPrice: unitPrice * item.quantity,
      merchantId: product.brand.ownerId,
    });
  }

  if (products.length === 0) {
    const err = new Error("Giỏ hàng không có sản phẩm hợp lệ để thanh toán");
    err.statusCode = 400;
    throw err;
  }
  return products;
}

async function deductStock(products, session) {
  for (const item of products) {
    const updated = await Product.findOneAndUpdate(
      { _id: item.productId, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { session, new: true },
    );
    if (!updated) {
      const err = new Error(`Sản phẩm "${item.name}" vừa hết hàng`);
      err.statusCode = 409;
      throw err;
    }
    if (updated.stock === 0) {
      await Product.findByIdAndUpdate(
        updated._id,
        { instock: false },
        { session },
      );
    }
  }
}

async function restoreStock(products, session) {
  for (const item of products) {
    await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { stock: item.quantity }, instock: true },
      { session },
    );
  }
}

async function applyCoupon(couponCode, subtotal, session) {
  const coupon = await Coupon.findOne({ code: couponCode }).session(session);
  if (!coupon) {
    const err = new Error("Mã giảm giá không tồn tại");
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  if (!coupon.isActive || now < coupon.startDate || now > coupon.expiresAt) {
    const err = new Error("Mã giảm giá đã hết hạn hoặc chưa có hiệu lực");
    err.statusCode = 400;
    throw err;
  }
  if (subtotal < coupon.minOrderValue) {
    const err = new Error(
      `Đơn hàng cần tối thiểu ${coupon.minOrderValue} để dùng mã này`,
    );
    err.statusCode = 400;
    throw err;
  }

  const claimed = await Coupon.findOneAndUpdate(
    {
      _id: coupon._id,
      isActive: true,
      $expr: {
        $or: [
          { $eq: ["$usageLimit", null] },
          { $lt: ["$usedCount", "$usageLimit"] },
        ],
      },
    },
    { $inc: { usedCount: 1 } },
    { session, new: true },
  );
  if (!claimed) {
    const err = new Error("Mã giảm giá đã hết lượt sử dụng");
    err.statusCode = 409;
    throw err;
  }

  const discountAmount =
    claimed.discountType === "percentage"
      ? Math.round((subtotal * claimed.discount) / 100)
      : Math.min(claimed.discount, subtotal);

  return { discountAmount, couponCode: claimed.code };
}

async function restoreCouponUsage(couponCode, session) {
  if (!couponCode) return;
  await Coupon.findOneAndUpdate(
    { code: couponCode, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
    { session },
  );
}

class CheckOutController {
  // ==== Tạo đơn hàng (COD hoặc online) ====
  async checkOut(req, res, next) {
    const session = await mongoose.startSession();
    let createdOrders = [];
    let paymentCode = "";
    let grandTotalAmount = 0;

    try {
      await session.withTransaction(async () => {
        // Reset mỗi lần chạy callback: withTransaction có thể retry khi gặp
        // TransientTransactionError, nếu không reset thì tổng tiền bị cộng dồn.
        grandTotalAmount = 0;
        const userId = req.userId;
        const { addressId, paymentMethod, note, couponCode } =
          req.validatedBody;

        const user = await User.findById(userId).session(session);
        const address = user.addresses.id(addressId);
        if (!address) {
          const err = new Error("Địa chỉ không hợp lệ");
          err.statusCode = 400;
          throw err;
        }

        const cart = await Cart.findOne({
          userId,
          isSubscribeCart: false,
        }).session(session);
        if (!cart || cart.items.length === 0) {
          const err = new Error("Giỏ hàng trống");
          err.statusCode = 400;
          throw err;
        }

        const products = await buildOrderProductsFromCart(cart, session);
        const subtotal = products.reduce((sum, p) => sum + p.totalPrice, 0);

        // Tính tổng phí ship dựa trên subtotal (nhỏ hơn 500k thì tính 30k)
        const totalShippingFee = subtotal > 0 && subtotal < 500000 ? 30000 : 0;

        let totalDiscountAmount = 0;
        let appliedCouponCode;
        if (couponCode) {
          const result = await applyCoupon(couponCode, subtotal, session);
          totalDiscountAmount = result.discountAmount;
          appliedCouponCode = result.couponCode;
        }

        const groupedProducts = products.reduce((acc, curr) => {
          const mId = curr.merchantId.toString();
          if (!acc[mId]) acc[mId] = [];
          acc[mId].push(curr);
          return acc;
        }, {});

        paymentCode =
          "TMART" +
          Date.now() +
          crypto.randomBytes(3).toString("hex").toUpperCase();

        const ordersToCreate = [];

        for (const merchantId of Object.keys(groupedProducts)) {
          const merchantProducts = groupedProducts[merchantId];
          const merchantSubtotal = merchantProducts.reduce(
            (sum, p) => sum + p.totalPrice,
            0,
          );

          const merchantDiscount =
            subtotal > 0
              ? Math.round(totalDiscountAmount * (merchantSubtotal / subtotal))
              : 0;

          // Chỉ gán phí vận chuyển vào đơn hàng đầu tiên được tách ra
          const orderShippingFee =
            ordersToCreate.length === 0 ? totalShippingFee : 0;

          // Cộng phí ship vào merchantTotal
          const merchantTotal =
            Math.max(0, merchantSubtotal - merchantDiscount) + orderShippingFee;

          grandTotalAmount += merchantTotal;
          const orderId =
            "ORD" +
            Date.now() +
            crypto.randomBytes(2).toString("hex").toUpperCase();

          ordersToCreate.push({
            userId,
            merchantId,
            paymentCode,
            customerEmail: user.email,
            products: merchantProducts,
            orderId,
            totalAmount: merchantTotal,
            shippingFee: orderShippingFee,
            discountAmount: merchantDiscount,
            couponCode: appliedCouponCode,
            shippingAddress: {
              fullName: user.name,
              phone: address.phone,
              address: address.address,
              district: address.district,
              city: address.city,
              country: address.country,
            },
            paymentMethod,
            paymentStatus: "pending",
            status: "pending",
            note,
            stockDeducted: paymentMethod === "cod" ? true : false,
          });

          if (paymentMethod === "cod") {
            await deductStock(merchantProducts, session);
          }
        }

        if (
          paymentMethod === "online" &&
          (!Number.isSafeInteger(grandTotalAmount) || grandTotalAmount <= 0)
        ) {
          const err = new Error(
            "Online payment requires a positive whole VND amount",
          );
          err.statusCode = 400;
          throw err;
        }
        createdOrders = [];
        for (const orderData of ordersToCreate) {
          const [newOrder] = await Order.create([orderData], { session });
          createdOrders.push(newOrder);
        }

        await Cart.deleteOne({ _id: cart._id }, { session });
      });

      // Notification delivery must not turn a committed checkout into an error.
      if (createdOrders[0].paymentMethod === "cod") {
        for (const order of createdOrders) {
          try {
            await notifyMerchant(order, "new_order");
          } catch (err) {
            logger.error(
              { err, orderId: order.orderId },
              "Notification failed",
            );
          }
        }
      }
      // The first child identifies the checkout; the code/amount cover every merchant.
      return res.status(201).json({
        success: true,
        data: {
          orderId: String(createdOrders[0]._id),
          orderCode: paymentCode,
          totalAmount: grandTotalAmount,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      session.endSession();
    }
  }

  // ==== Webhook SePay ====
  async sepayWebhook(req, res, next) {
    const {
      content,
      code,
      transferAmount,
      transferType,
      referenceCode,
      accountNumber,
    } = req.validatedBody;

    if (transferType !== "in") return res.json({ success: true });

    if (accountNumber !== process.env.SEPAY_BANK_ACCOUNT) {
      return res
        .status(400)
        .json({ success: false, message: "Unexpected receiving account" });
    }

    const matched = (
      code ||
      content.match(/TMART[A-Z0-9]+/i)?.[0] ||
      ""
    ).toUpperCase();

    if (!matched) return res.json({ success: true });

    let session;
    let paidOrders = [];
    let alreadyProcessed = false;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        paidOrders = [];
        alreadyProcessed = false;

        // Kiểm tra bên trong transaction (đáp ứng đúng yêu cầu của unit test lẫn integration test)
        if (
          await Order.exists({ paidReferenceCode: referenceCode }).session(
            session,
          )
        ) {
          alreadyProcessed = true;
          return;
        }

        const orders = await Order.find({ paymentCode: matched })
          .sort({ _id: 1 })
          .session(session);

        if (!orders.length) return;
        if (orders.every((order) => order.paymentStatus === "paid")) {
          alreadyProcessed = true;
          return;
        }

        if (
          orders.some(
            (order) =>
              order.paymentMethod !== "online" ||
              order.status !== "pending" ||
              order.paymentStatus !== "pending",
          )
        ) {
          const err = new Error(
            "Payment requires reconciliation: checkout is no longer payable",
          );
          err.statusCode = 409;
          throw err;
        }

        const total = orders.reduce((sum, order) => sum + order.totalAmount, 0);
        if (transferAmount < total) {
          const err = new Error("Underpayment requires reconciliation");
          err.statusCode = 422;
          throw err;
        }

        for (let index = 0; index < orders.length; index++) {
          const order = orders[index];
          if (index === 0) {
            order.paidReferenceCode = referenceCode;
            order.overpaidAmount = transferAmount - total;
            order.isOverpaid = transferAmount > total;
          }
          order.paymentStatus = "paid";
          order.paidAt = new Date();
          const reserved = [];
          try {
            for (const item of order.products) {
              await deductStock([item], session);
              reserved.push(item);
            }
            order.stockDeducted = true;
            order.status = "processing";
          } catch (err) {
            if (err.statusCode !== 409) throw err;
            await restoreStock(reserved, session);
            order.stockDeducted = false;
            order.status = "on_hold";
            order._statusChangeNote =
              "Payment received; inventory needs reconciliation";
          }
          await order.save({ session });
          paidOrders.push(order);
        }
      });

      for (const order of paidOrders) {
        try {
          await notifyMerchant(order, "payment_received");
        } catch (err) {
          logger.error({ err, orderId: order.orderId }, "Notification failed");
        }
      }
      if (alreadyProcessed) {
        return res.json({
          success: true,
          message: "Payment already processed",
        });
      }
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[sepayWebhook] payment processing failed");
      return res.status(err.statusCode || 503).json({
        success: false,
        message: err.statusCode
          ? err.message
          : "Payment processing failed; retry required",
      });
    } finally {
      if (session) await session.endSession();
    }
  }

  // ==== User: kiểm tra trạng thái thanh toán theo paymentCode ====
  async getOrderStatus(req, res, next) {
    try {
      const { paymentCode } = req.params;

      const orders = await Order.find({ paymentCode }).select(
        "orderId userId status paymentStatus totalAmount paymentMethod",
      );

      if (orders.length === 0) {
        const err = new Error("Không tìm thấy đơn hàng với mã thanh toán này");
        err.statusCode = 404;
        throw err;
      }

      if (
        req.user.role !== "admin" &&
        String(orders[0].userId) !== req.userId
      ) {
        const err = new Error("Không có quyền xem đơn hàng này");
        err.statusCode = 403;
        throw err;
      }

      const paymentStatus = orders.every((o) => o.paymentStatus === "paid")
        ? "paid"
        : "pending";

      const data = {
        paymentStatus,
        orders: orders.map((o) => ({
          orderId: o.orderId,
          status: o.status,
          paymentStatus: o.paymentStatus,
          totalAmount: o.totalAmount,
        })),
      };

      if (paymentStatus === "pending" && orders[0].paymentMethod === "online") {
        const grandTotalAmount = orders.reduce(
          (sum, o) => sum + o.totalAmount,
          0,
        );
        data.qrUrl = buildQrUrl(paymentCode, grandTotalAmount);
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==== Admin xác nhận đơn COD ====
  async confirmCodOrder(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params._id,
        paymentMethod: "cod",
        status: "pending",
      });
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Đơn không tồn tại hoặc không ở trạng thái chờ xác nhận",
        });
      }
      order._statusChangedBy = req.userId;
      order.status = "processing";
      await order.save();
      res
        .status(200)
        .json({ success: true, message: "Đã xác nhận đơn hàng", data: order });
    } catch (error) {
      next(error);
    }
  }

  // ==== Admin/shipper xác nhận đã giao và đã thu tiền COD ====
  async markCodDelivered(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params._id,
        paymentMethod: "cod",
      });
      if (!order || !["processing", "shipped"].includes(order.status)) {
        return res.status(404).json({
          success: false,
          message: "Đơn không hợp lệ để xác nhận đã giao",
        });
      }
      order._statusChangedBy = req.userId;
      order.status = "delivered";
      order.paymentStatus = "paid";
      await order.save();
      res.status(200).json({
        success: true,
        message: "Đã xác nhận giao hàng thành công",
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==== Huỷ đơn ====
  async cancelOrder(req, res, next) {
    const session = await mongoose.startSession();
    let cancelled;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(req.params._id).session(session);
        if (!order) {
          const err = new Error("Đơn hàng không tồn tại");
          err.statusCode = 404;
          throw err;
        }
        if (req.user.role !== "admin" && String(order.userId) !== req.userId) {
          const err = new Error("Không có quyền huỷ đơn hàng này");
          err.statusCode = 403;
          throw err;
        }
        if (!["pending", "processing"].includes(order.status)) {
          const err = new Error("Đơn hàng không thể huỷ ở trạng thái hiện tại");
          err.statusCode = 400;
          throw err;
        }

        if (order.stockDeducted) {
          await restoreStock(order.products, session);
          order.stockDeducted = false;
        }
        if (order.couponCode) {
          await restoreCouponUsage(order.couponCode, session);
        }
        if (order.paymentStatus === "paid") {
          order.refundStatus = "pending";
          order.refundAmount = order.totalAmount;
        }

        order._statusChangedBy = req.userId;
        order.cancelReason = req.body.reason || "Không có lý do";
        order.cancelledBy = req.userId;
        order.status = "cancelled";
        await order.save({ session });
        cancelled = order;
      });

      await notifyRefundOrCancel(cancelled);
      res
        .status(200)
        .json({ success: true, message: "Đã huỷ đơn hàng", data: cancelled });
    } catch (error) {
      next(error);
    } finally {
      session.endSession();
    }
  }

  // ==== Admin: danh sách đơn đang chờ hoàn tiền ====
  async getPendingRefunds(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

      const [orders, total] = await Promise.all([
        Order.find({ refundStatus: "pending" })
          .sort({ cancelledAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Order.countDocuments({ refundStatus: "pending" }),
      ]);

      res.status(200).json({
        success: true,
        message: "Danh sách đơn chờ hoàn tiền",
        data: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==== Admin: đánh dấu đã hoàn tiền xong ====
  async completeRefund(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params._id,
        refundStatus: "pending",
      });
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy đơn hàng đang chờ hoàn tiền",
        });
      }
      order.refundStatus = "completed";
      order.refundedAt = new Date();
      await order.save();
      res.status(200).json({
        success: true,
        message: "Đã đánh dấu hoàn tiền thành công",
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }
}

async function notifyRefundOrCancel(cancelledOrder) {
  try {
    await notifyMerchant(cancelledOrder, "order_cancelled");
  } catch (err) {
    logger.error(
      { err, orderId: cancelledOrder.orderId },
      "Lỗi gửi thông báo huỷ đơn",
    );
  }
}

module.exports = new CheckOutController();
