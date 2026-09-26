const express = require("express");
const router = express.Router();
const brandController = require("../controllers/brandController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");
const brandLogoUpload = require("../middleware/brandLogoUpload");

router.post(
  "/create-brand",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  brandLogoUpload,
  validationHandler.validate(validationSchemas.brandSchema),
  brandController.createBrand,
);
router.put(
  "/update-brand/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  brandLogoUpload,
  // A file is in req.file, not req.body: allow an empty text body only with a logo.
  (req, res, next) =>
    validationHandler.validate(
      req.file
        ? validationSchemas.updateBrandSchema.min(0)
        : validationSchemas.updateBrandSchema,
    )(req, res, next),
  brandController.updateBrand,
);
router.delete(
  "/delete-brand/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  brandController.deleteBrand,
);

router.get("/get-all-brands", brandController.getAllBrands);

module.exports = router;
