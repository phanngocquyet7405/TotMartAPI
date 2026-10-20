const express = require("express");
const router = express.Router();
const couponController = require("../controllers/couponController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const {
  couponSchema,
  updateCouponSchema,
  idParamSchema,
} = require("../middleware/validationSchemas");

router.post(
  "/create-coupon",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  validationHandler.validate(couponSchema, "body"),
  couponController.createCoupon,
);

router.get(
  "/get-all-coupons",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  couponController.getAllCoupons,
);

router.put(
  "/update-coupon/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  validationHandler.validate(updateCouponSchema, "body"),
  couponController.updateCoupon,
);

router.delete(
  "/delete-coupon/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  couponController.deleteCoupon,
);

module.exports = router;
