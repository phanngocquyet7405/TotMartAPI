const Order = require('../models/Order');

// Explicit customer fields exclude merchant and internal reconciliation data.
const fields =
  'giftFee bulkDiscountAmount pricingPolicyVersion products.gift products.giftFee products.bulkDiscountAmount products.lineId products.boxId orderId paymentCode products.name products.quantity products.unitPrice products.totalPrice status totalAmount shippingFee shippingPayment discountAmount shippingAddress paymentMethod paymentStatus createdAt deliveredAt cancelReason refundStatus';

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const filter = {
      userId: req.userId,
      $nor: [{ paymentMethod: 'online', paymentStatus: { $ne: 'paid' } }],
    };
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
    if (!data || (data.paymentMethod === 'online' && data.paymentStatus !== 'paid'))
      return res.status(404).json({ success: false, message: 'Order not found' });
    const siblings = await Order.find({
      paymentCode: data.paymentCode,
      userId: req.userId,
    })
      .select('totalAmount paymentStatus status')
      .lean();
    const status =
      siblings.length && siblings.every((order) => order.paymentStatus === 'paid')
        ? 'paid'
        : siblings.some((order) => ['cancelled', 'returned'].includes(order.status))
          ? 'cancelled'
          : 'pending';
    // Top-level status is payment status. data.status remains the shipping lifecycle.
    res.json({
      success: true,
      status,
      data: {
        ...data,
        checkout: {
          orderId: String(data._id),
          orderCode: data.paymentCode,
          totalAmount: siblings.reduce((sum, order) => sum + order.totalAmount, 0),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Customer reports receipt only; never confirms COD money or changes the checkout ledger.
exports.confirmReceipt = async (req, res, next) => {
  try {
    const filter = {
      _id: req.params._id,
      userId: req.userId,
      status: 'shipped',
      paymentMethod: 'online',
      paymentStatus: 'paid',
    };
    const now = new Date();
    const data = await Order.findOneAndUpdate(
      filter,
      {
        $set: { status: 'delivered', deliveredAt: now, deliveryConfirmedBy: req.userId },
        $inc: { __v: 1 },
        $push: {
          statusHistory: {
            status: 'delivered',
            changedBy: req.userId,
            changedAt: now,
            note: 'Khách xác nhận đã nhận hàng',
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (data)
      return res.json({
        success: true,
        data: { _id: data._id, status: data.status, deliveredAt: data.deliveredAt },
      });
    const current = await Order.findOne({ _id: req.params._id, userId: req.userId }).select(
      'status paymentMethod paymentStatus',
    );
    if (!current) return res.status(404).json({ success: false, message: 'Order not found' });
    if (
      current.status === 'delivered' &&
      current.paymentMethod === 'online' &&
      current.paymentStatus === 'paid'
    )
      return res.json({ success: true, data: current });
    res
      .status(409)
      .json({ success: false, message: 'Chỉ xác nhận đơn online đã thanh toán và đang giao' });
  } catch (error) {
    next(error);
  }
};
