const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const { idParamSchema } = require("../middleware/validationSchemas");

router.get(
  "/stream-ticket",
  require("../middleware/rateLimiter").ticketLimiter,
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  notificationController.issueStreamTicket,
);

router.get("/stream", notificationController.streamNotifications);

router.get(
  "/",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  notificationController.getNotifications,
);

router.patch(
  "/mark-all-read",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  notificationController.markAllAsRead,
);

router.patch(
  "/:_id/mark-read",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  notificationController.markAsRead,
);

module.exports = router;
