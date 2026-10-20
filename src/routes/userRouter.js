const express = require("express");
const routers = express.Router();

const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const validationHandler = require("../middleware/validationHandler");
const validationSchemas = require("../middleware/validationSchemas");
const { authLimiter } = require("../middleware/rateLimiter");

routers.post(
  "/register",
  authLimiter,
  validationHandler.validate(validationSchemas.registerSchema),
  userController.createUser,
);
routers.get(
  "/get-all-users",
  authMiddleware.adminMiddleware,
  userController.getAllUsers,
);
routers.get(
  "/get-user-by-id/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireOwnerOrAdmin,
  userController.getUserById,
);
routers.put(
  "/update-user/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireOwnerOrAdmin,
  validationHandler.validate(validationSchemas.updateUserSchema),
  userController.updateUser,
);
routers.delete(
  "/lock-user/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  userController.lockUser,
);
routers.patch(
  "/unlock-user/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  userController.unlockUser,
);
routers.delete(
  "/delete-user/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireAdmin,
  userController.deleteUser,
);
routers.post(
  "/update-address/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireOwnerOrAdmin,
  validationHandler.validate(validationSchemas.updateAddressSchema),
  userController.updateAddress,
);

routers.put(
  "/edit-address/:_id/:address_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireOwnerOrAdmin,
  validationHandler.validate(validationSchemas.updateAddressSchema),
  userController.editAddress,
);

routers.delete(
  "/delete-address/:_id/:address_id",
  authMiddleware.authenticate,
  validationHandler.validate(validationSchemas.idParamSchema, "params"),
  authMiddleware.requireOwnerOrAdmin,
  userController.deleteAddress,
);

routers.get("/me", authMiddleware.authenticate, userController.getMyProfile);

module.exports = routers;
