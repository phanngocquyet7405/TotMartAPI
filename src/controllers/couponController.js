const Coupon = require('../models/Coupon');

class CouponController {
  // ==== Admin tạo mã giảm giá ====
  async createCoupon(req, res, next) {
    try {
      const validated = req.validatedBody;
      const existing = await Coupon.findOne({ code: validated.code });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Mã giảm giá đã tồn tại' });
      }
      const coupon = await Coupon.create(validated);
      res.status(201).json({
        success: true,
        message: 'Tạo mã giảm giá thành công',
        data: coupon,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==== Admin xem danh sách mã giảm giá ====
  async getAllCoupons(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

      const [coupons, total] = await Promise.all([
        Coupon.find()
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Coupon.countDocuments(),
      ]);

      res.status(200).json({
        success: true,
        message: 'Lấy danh sách mã giảm giá thành công',
        data: coupons,
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

  // ==== Admin sửa mã giảm giá ====
  async updateCoupon(req, res, next) {
    try {
      const validated = req.validatedBody;
      const coupon = await Coupon.findByIdAndUpdate(req.params._id, validated, {
        new: true,
        runValidators: true,
      });
      if (!coupon) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
      }
      res.status(200).json({
        success: true,
        message: 'Cập nhật mã giảm giá thành công',
        data: coupon,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==== Admin xoá mã giảm giá ====
  async deleteCoupon(req, res, next) {
    try {
      const coupon = await Coupon.findByIdAndDelete(req.params._id);
      if (!coupon) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
      }
      res.status(200).json({
        success: true,
        message: 'Xoá mã giảm giá thành công',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CouponController();
