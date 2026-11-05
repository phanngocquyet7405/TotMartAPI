const express = require("express");
const router = express.Router();
const orderAdminController = require("../controllers/orderAdminController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const {
  idParamSchema,
  orderStatusUpdateSchema,
} = require("../middleware/validationSchemas");

// Authenticate once, then authorize using the current database role.

// ==== Admin: danh sách đơn hàng ====
router.get(
  "/",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  orderAdminController.getAllOrders,
);

// ==== Admin: chi tiết 1 đơn hàng ====
router.get(
  "/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  orderAdminController.getOrderById,
);

// ==== Admin: đổi trạng thái — chỉ các bước không có side-effect. "cancelled",
// "processing" (từ COD pending), "delivered" (COD) dùng route riêng ở
// /api/checkout (xem ghi chú ở orderAdminController.js) ====
router.post(
  "/:_id/status",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  validationHandler.validate(orderStatusUpdateSchema, "body"),
  orderAdminController.updateOrderStatus,
);

module.exports = router;
