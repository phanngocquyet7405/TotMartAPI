const express = require("express");
const router = express.Router();
const boxController = require("../controllers/boxController");

const upload = require("../middleware/uploadMiddleware");

const validateHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");
const authMiddleware = require("../middleware/authMiddleware");

router.post(
  "/create-box",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  upload.array("images", 10),
  validateHandler.validate(validationSchemas.createBoxSchema),
  boxController.createBox,
);

router.get("/get-all-box", boxController.getAllBoxes);

router.get(
  "/get-box-by-id/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  boxController.getBoxById,
);

router.put(
  "/update-box/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  upload.array("images", 10),
  validateHandler.validate(validationSchemas.updateBoxSchema),
  boxController.updateBox,
);

router.delete(
  "/delete-box/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  boxController.deleteBox,
);

router.get("/get-products-in-box/:_id", boxController.getProductsInBox);

router.get(
  "/get-box-offer-discount-coupons",
  boxController.getBoxOfferDicountCoupons,
);

module.exports = router;
