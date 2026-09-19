const Order = require("../models/Order");

const GENERIC_TRANSITIONS = {
  processing: ["shipped"],
  shipped: ["delivered"],
  on_hold: ["processing"],
};

const orderAdminController = {
  async getAllOrders(req, res, next) {
    try {
      const { page = 1, limit = 20, status, paymentMethod, search } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (paymentMethod) filter.paymentMethod = paymentMethod;
      if (search) {
        const regex = { $regex: search, $options: "i" };
        filter.$or = [
          { orderId: regex },
          { paymentCode: regex },
          { customerEmail: regex },
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .populate("userId", "name email phone")
          .sort({ createdAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum),
        Order.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        data: orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // ==== Admin: chi tiết 1 đơn hàng ====
  async getOrderById(req, res, next) {
    try {
      const order = await Order.findById(req.params._id).populate(
        "userId",
        "name email phone",
      );
      if (!order) {
        const err = new Error("Đơn hàng không tồn tại");
        err.statusCode = 404;
        throw err;
      }
      res.status(200).json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  },

  // ==== Admin: đổi trạng thái — CHỈ các bước không có side-effect (xem
  // GENERIC_TRANSITIONS ở trên) ====
  async updateOrderStatus(req, res, next) {
    try {
      const { status: nextStatus } = req.validatedBody;

      const order = await Order.findById(req.params._id);
      if (!order) {
        const err = new Error("Đơn hàng không tồn tại");
        err.statusCode = 404;
        throw err;
      }

      const allowed = GENERIC_TRANSITIONS[order.status] || [];
      if (!allowed.includes(nextStatus)) {
        const err = new Error(
          `Không thể chuyển từ "${order.status}" sang "${nextStatus}" ở đây. ` +
            `Nếu đây là huỷ đơn, xác nhận COD, hoặc xác nhận giao COD, dùng đúng action riêng cho việc đó.`,
        );
        err.statusCode = 400;
        throw err;
      }

      // "shipped" -> "delivered" chỉ an toàn ở đây cho đơn ONLINE (đã
      // paymentStatus = "paid" từ webhook). Đơn COD "đã giao" phải qua
      // markCodDelivered() để đồng thời ghi nhận đã thu tiền mặt.
      if (nextStatus === "delivered" && order.paymentMethod === "cod") {
        const err = new Error(
          'Đơn COD "đã giao" phải xác nhận qua action riêng (có thu tiền COD), không dùng action này.',
        );
        err.statusCode = 400;
        throw err;
      }

      order._statusChangedBy = req.userId;
      order.status = nextStatus;
      await order.save();

      res.status(200).json({
        success: true,
        message: "Đã cập nhật trạng thái đơn hàng",
        data: order,
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = orderAdminController;
