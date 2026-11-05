const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const { idParamSchema } = require("../middleware/validationSchemas");

router.get(
  "/stream-ticket",
  require("../middleware/rateLimiter").ticketLimiter,
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  notificationController.issueStreamTicket,
);

router.get("/stream", notificationController.streamNotifications);

router.get(
  "/",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  notificationController.getNotifications,
);

router.patch(
  "/mark-all-read",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  notificationController.markAllAsRead,
);

router.patch(
  "/:_id/mark-read",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  notificationController.markAsRead,
);

module.exports = router;
