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
  authMiddleware.authMiddleware,
  cartController.getCartByUser,
);
router.get(
  "/get-all-cart",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  cartController.getAllCart,
);
router.post(
  "/add-to-cart",
  authMiddleware.authMiddleware,
  validationHandler.validate(addToCartSchema, "body"),
  cartController.addToCart,
);
// FE đồng bộ giỏ localStorage lên DB ngay trước khi checkout
router.put(
  "/sync",
  authMiddleware.authMiddleware,
  validationHandler.validate(syncCartSchema, "body"),
  cartController.syncCart,
);
router.put(
  "/update-cart/:_id",
  authMiddleware.authMiddleware,
  validationHandler.validate(updateCartSchema, "body"),
  cartController.updateCart,
);
router.delete(
  "/delete-from-cart/:_id",
  authMiddleware.authMiddleware,
  cartController.deleteFromCart,
);

router.post(
  "/add-subscribe-plan-to-cart",
  authMiddleware.authMiddleware,
  cartController.addSubscribeCart,
);
router.put(
  "/update-subscribe-cart",
  authMiddleware.authMiddleware,
  cartController.updateSubscribeCart,
);
router.delete(
  "/delete-from-subscribe-cart/:_id",
  authMiddleware.authMiddleware,
  cartController.deleteFromSubscribeCart,
);

router.get(
  "/get-subscribe-cart/:_id",
  authMiddleware.authMiddleware,
  cartController.getSubscribeCartByUser,
);
module.exports = router;
