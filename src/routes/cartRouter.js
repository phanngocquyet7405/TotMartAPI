const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const {
  syncCartSchema,
  addToCartSchema,
  updateCartSchema,
} = require("../middleware/validationSchemas");

router.get(
  "/get-cart/:_id",
  authMiddleware.authenticate,
  cartController.getCartByUser,
);
router.get(
  "/get-all-cart",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  cartController.getAllCart,
);
router.post(
  "/add-to-cart",
  authMiddleware.authenticate,
  validationHandler.validate(addToCartSchema, "body"),
  cartController.addToCart,
);
// FE đồng bộ giỏ localStorage lên DB ngay trước khi checkout
router.put(
  "/sync",
  authMiddleware.authenticate,
  validationHandler.validate(syncCartSchema, "body"),
  cartController.syncCart,
);
router.put(
  "/update-cart/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(updateCartSchema, "body"),
  cartController.updateCart,
);
router.delete(
  "/delete-from-cart/:_id",
  authMiddleware.authenticate,
  cartController.deleteFromCart,
);

router.post(
  "/add-subscribe-plan-to-cart",
  authMiddleware.authenticate,
  validationHandler.validate(require("../middleware/validationSchemas").subscriptionCartSchema),
  cartController.addSubscribeCart,
);
router.put(
  "/update-subscribe-cart",
  authMiddleware.authenticate,
  validationHandler.validate(require("../middleware/validationSchemas").subscriptionCartSchema),
  cartController.updateSubscribeCart,
);
router.delete(
  "/delete-from-subscribe-cart/:_id",
  authMiddleware.authenticate,
  cartController.deleteFromSubscribeCart,
);

router.get(
  "/get-subscribe-cart/:_id",
  authMiddleware.authenticate,
  cartController.getSubscribeCartByUser,
);
module.exports = router;
