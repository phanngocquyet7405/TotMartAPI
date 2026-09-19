const express = require("express");
const router = express.Router();
const orderAdminController = require("../controllers/orderAdminController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const {
  idParamSchema,
  orderStatusUpdateSchema,
} = require("../middleware/validationSchemas");

// Toàn bộ router này chỉ dành cho admin — áp cả 2 middleware như convention
// đã dùng ở checkOutRouter (authMiddleware set req.user, adminMiddleware
// chặn role khác admin).

// ==== Admin: danh sách đơn hàng ====
router.get(
  "/",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  orderAdminController.getAllOrders,
);

// ==== Admin: chi tiết 1 đơn hàng ====
router.get(
  "/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  orderAdminController.getOrderById,
);

// ==== Admin: đổi trạng thái — chỉ các bước không có side-effect. "cancelled",
// "processing" (từ COD pending), "delivered" (COD) dùng route riêng ở
// /api/checkout (xem ghi chú ở orderAdminController.js) ====
router.post(
  "/:_id/status",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  validationHandler.validate(orderStatusUpdateSchema, "body"),
  orderAdminController.updateOrderStatus,
);

module.exports = router;
