const express = require("express");
const router = express.Router();

const productController = require("../controllers/productController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");

const upload = require("../middleware/uploadMiddleware");

router.post(
  "/create-product/",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  upload.array("images", 10),
  validationHandler.validate(validationSchemas.productSchema),
  productController.createProduct,
);

router.get("/get-all-products/", productController.getAllProducts);

router.put(
  "/update-product/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  upload.array("images", 10),
  (req, res, next) => validationHandler.validate(req.files?.length ? validationSchemas.productUpdateSchema.min(0) : validationSchemas.productUpdateSchema)(req, res, next),
  productController.updateProduct,
);

router.patch(
  "/adjust-stock/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  validationHandler.validate(validationSchemas.adjustStockSchema),
  productController.adjustStock,
);

router.delete(
  "/delete-product/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  productController.deleteProduct,
);

router.get(
  "/get-products-by-id/:_id",
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  productController.getProductById,
);

module.exports = router;
