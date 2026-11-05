const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");
const { authLimiter, refreshLimiter } = require("../middleware/rateLimiter");

router.get('/health', require('../controllers/healthController').readiness);
router.get('/live', require('../controllers/healthController').liveness);

router.post(
  "/login",
  authLimiter,
  validationHandler.validate(validationSchemas.loginSchema),
  authController.login,
);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", auth.authenticate, authController.logout);
router.post(
  "/forgot-password",
  authLimiter,
  validationHandler.validate(validationSchemas.forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  validationHandler.validate(validationSchemas.resetPasswordSchema),
  authController.resetPassword,
);

module.exports = router;
