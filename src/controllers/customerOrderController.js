const Order = require("../models/Order");

// Explicit customer fields exclude merchant and internal reconciliation data.
const fields =
  "orderId products.name products.quantity products.unitPrice products.totalPrice status totalAmount shippingFee discountAmount shippingAddress paymentMethod paymentStatus createdAt deliveredAt cancelReason refundStatus";

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(
      1,
      Math.min(50, parseInt(req.query.limit, 10) || 10),
    );
    const filter = { userId: req.userId };
    const [data, total] = await Promise.all([
      Order.find(filter)
        .select(fields)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const data = await Order.findOne({
      _id: req.params._id,
      userId: req.userId,
    })
      .select(fields)
      .lean();
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
