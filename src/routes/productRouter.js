const express = require("express");
const router = express.Router();

const productController = require("../controllers/productController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");

const upload = require("../middleware/uploadMiddleware");

router.post(
  "/create-product/",
  upload.array("images", 10),
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(validationSchemas.productSchema),
  productController.createProduct,
);

router.get("/get-all-products/", productController.getAllProducts);

router.put(
  "/update-product/:_id",
  upload.array("images", 10),
  validationHandler.validate(validationSchemas.productUpdateSchema),
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  productController.updateProduct,
);

router.delete(
  "/delete-product/:_id",
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  productController.deleteProduct,
);

router.get(
  "/get-products-by-id/:_id",
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  productController.getProductById,
);

module.exports = router;
