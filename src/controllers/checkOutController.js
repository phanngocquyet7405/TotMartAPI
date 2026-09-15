const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Product = require("../models/Product");
const Coupon = require("../models/Coupon");
const { notifyMerchant } = require("../utils/notify");

function buildQrUrl(orderId, amount) {
  const acc = process.env.SEPAY_BANK_ACCOUNT;
  const bank = process.env.SEPAY_BANK_NAME;
  return `https://qr.sepay.vn/img?acc=${acc}&bank=${bank}&amount=${amount}&des=${orderId}`;
}

// Build mảng products cho Order từ Cart hiện tại — snapshot giá thật tại thời điểm mua
// (áp dụng salePercent nếu có), đồng thời validate tồn kho ngay tại bước này.
async function buildOrderProductsFromCart(cart, session) {
  const products = [];
  for (const item of cart.items) {
    if (!item.productId) continue;

    // Phải .populate("brand") ngay trong này để lấy được ownerId
    const product = await Product.findById(item.productId)
      .populate("brand")
      .session(session);

    if (!product) {
      const err = new Error("Một sản phẩm trong giỏ hàng không còn tồn tại");
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
// Trừ kho atomic — điều kiện stock nằm ngay trong query filter để tránh 2 request
// cùng trừ vượt quá tồn kho thực tế (race condition).
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

// Xác thực coupon (còn hạn, đủ điều kiện đơn tối thiểu) và trừ lượt dùng atomic —
// điều kiện usageLimit nằm ngay trong query filter (giống pattern deductStock ở trên)
// để 2 request cùng dùng 1 coupon giới hạn lượt không thể cùng vượt quá usageLimit.
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

// Trả lại lượt dùng coupon khi đơn có dùng mã bị huỷ — đối xứng với restoreStock ở trên.
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

        // Xử lý Coupon tổng
        let totalDiscountAmount = 0;
        let appliedCouponCode;
        if (couponCode) {
          const result = await applyCoupon(couponCode, subtotal, session);
          totalDiscountAmount = result.discountAmount;
          appliedCouponCode = result.couponCode;
        }

        // BƯỚC QUAN TRỌNG: Nhóm sản phẩm theo merchantId
        const groupedProducts = products.reduce((acc, curr) => {
          const mId = curr.merchantId.toString();
          if (!acc[mId]) acc[mId] = [];
          acc[mId].push(curr);
          return acc;
        }, {});

        // Tạo mã thanh toán chung để gửi cho SePay (Nếu khách dùng SePay QR)
        paymentCode =
          "TMART" +
          Date.now() +
          crypto.randomBytes(3).toString("hex").toUpperCase();

        const ordersToCreate = [];

        // Lặp qua từng gian hàng để tách thành từng Order riêng biệt
        for (const merchantId of Object.keys(groupedProducts)) {
          const merchantProducts = groupedProducts[merchantId];
          const merchantSubtotal = merchantProducts.reduce(
            (sum, p) => sum + p.totalPrice,
            0,
          );

          // Chia đều tiền giảm giá coupon theo tỷ lệ giá trị đơn hàng của từng gian hàng
          const merchantDiscount =
            subtotal > 0
              ? Math.round(totalDiscountAmount * (merchantSubtotal / subtotal))
              : 0;
          const merchantTotal = Math.max(
            0,
            merchantSubtotal - merchantDiscount,
          );

          grandTotalAmount += merchantTotal; // Cộng dồn vào tổng tiền cuối cùng phải trả
          const orderId =
            "ORD" +
            Date.now() +
            crypto.randomBytes(2).toString("hex").toUpperCase();

          ordersToCreate.push({
            userId,
            merchantId, // Đừng quên thêm 2 trường này vào models/Order.js nhé!
            paymentCode,
            customerEmail: user.email,
            products: merchantProducts,
            orderId,
            totalAmount: merchantTotal,
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

          // Trừ kho luôn nếu là COD
          if (paymentMethod === "cod") {
            await deductStock(merchantProducts, session);
          }
        }

        // Tạo 1 loạt đơn hàng cùng lúc
        createdOrders = [];
        for (const orderData of ordersToCreate) {
          const [newOrder] = await Order.create([orderData], { session });
          createdOrders.push(newOrder);
        }

        // Dọn giỏ hàng
        await Cart.deleteOne({ _id: cart._id }, { session });
      });

      // Báo notification cho TỪNG merchant nếu là COD
      if (createdOrders[0].paymentMethod === "cod") {
        for (const order of createdOrders) {
          await notifyMerchant(order, "new_order");
        }
      }

      // Format dữ liệu trả về cho Frontend
      const data = {
        paymentCode: paymentCode,
        grandTotalAmount: grandTotalAmount,
        orders: createdOrders.map((o) => o.orderId), // Trả về danh sách mã đơn hàng vừa tách
      };

      if (createdOrders[0].paymentMethod === "online") {
        data.qrUrl = buildQrUrl(paymentCode, grandTotalAmount);
      }

      res
        .status(200)
        .json({ success: true, message: "Khởi tạo đơn hàng thành công", data });
    } catch (error) {
      next(error);
    } finally {
      session.endSession();
    }
  }

  // ==== Webhook SePay — field đúng theo docs thật: content, transferAmount, transferType, code, referenceCode ====
  // ==== Webhook SePay ====
  async sepayWebhook(req, res, next) {
    try {
      const { content, code, transferAmount, transferType, referenceCode } =
        req.validatedBody;

      if (transferType !== "in") {
        return res.status(200).json({
          success: true,
          message: "Ignored: not an incoming transfer",
        });
      }

      // 1. Lấy mã thanh toán chung (paymentCode)
      const matched = code || (content.match(/TMART[A-Z0-9]+/) || [])[0];
      if (!matched) {
        return res
          .status(200)
          .json({ success: true, message: "No order code found" });
      }

      // 2. Chống xử lý trùng webhook
      const alreadyProcessed = await Order.exists({
        paidReferenceCode: referenceCode,
      });
      if (alreadyProcessed) {
        return res
          .status(200)
          .json({ success: true, message: "Already processed" });
      }

      // 3. Tìm TẤT CẢ các đơn hàng con có chung paymentCode
      const pendingOrders = await Order.find({
        paymentCode: matched,
        paymentStatus: "pending",
      });

      if (!pendingOrders || pendingOrders.length === 0) {
        return res.status(200).json({
          success: true,
          message: "Orders not found or already processed",
        });
      }

      // 4. Tính TỔNG TIỀN yêu cầu của tất cả đơn hàng con này
      const totalRequiredAmount = pendingOrders.reduce(
        (sum, order) => sum + order.totalAmount,
        0,
      );

      // 5. Kiểm tra khách chuyển đủ tiền chưa
      if (Number(transferAmount) < totalRequiredAmount) {
        for (const order of pendingOrders) {
          order._statusChangeNote = `Nhận ${transferAmount}/${totalRequiredAmount} qua ref ${referenceCode} — thiếu tiền, cần đối soát thủ công`;
          await order.save();
        }
        return res
          .status(200)
          .json({ success: true, message: "Underpaid, flagged for review" });
      }

      const session = await mongoose.startSession();
      const paidOrders = []; // Mảng lưu các đơn đã xử lý thành công để báo notification

      try {
        await session.withTransaction(async () => {
          // 6. Xử lý TỪNG đơn hàng con
          for (const pendingOrder of pendingOrders) {
            const order = await Order.findOneAndUpdate(
              { _id: pendingOrder._id, paymentStatus: "pending" },
              {
                $set: {
                  paymentStatus: "paid",
                  paidReferenceCode: referenceCode,
                },
              },
              { session, new: true },
            );

            if (!order) continue; // Đơn đã được update bởi process khác

            try {
              // Online checkout chưa trừ kho, giờ thanh toán xong mới trừ
              await deductStock(order.products, session);
              order.status = "processing";
              order.stockDeducted = true;
            } catch (stockError) {
              order.status = "on_hold";
              order._statusChangeNote = `Đã nhận tiền nhưng thiếu hàng khi xử lý: ${stockError.message}`;
            }
            await order.save({ session });
            paidOrders.push(order);
          }
        });
      } finally {
        session.endSession();
      }

      // 7. Bắn thông báo cho TỪNG Merchant
      for (const paidOrder of paidOrders) {
        await notifyMerchant(paidOrder, "payment_received");
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("[sepayWebhook] error:", error);
      res
        .status(200)
        .json({ success: false, message: "Internal error, logged for review" });
    }
  }

  // ==== Admin xác nhận đơn COD (bước gọi điện xác nhận trước khi giao) ====
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

  // ==== Huỷ đơn — user tự huỷ đơn của mình, hoặc admin huỷ bất kỳ đơn nào ====
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

      await notifyMerchant(cancelled, "order_cancelled");
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

  // ==== Admin: đánh dấu đã hoàn tiền xong (thao tác hoàn tiền thật diễn ra ngoài hệ thống) ====
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

module.exports = new CheckOutController();
