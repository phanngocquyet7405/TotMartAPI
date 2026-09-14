const express = require('express');
const routers = express.Router();

const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const validationHandler = require('../middleware/validationHandler');
const validationSchemas = require('../middleware/validationSchemas');
const { authLimiter } = require('../middleware/rateLimiter');

routers.post(
  '/register',
  authLimiter,
  validationHandler.validate(validationSchemas.registerSchema),
  userController.createUser
);
routers.get(
  '/get-all-users',
  authMiddleware.adminMiddleware,
  authMiddleware.authMiddleware,
  userController.getAllUsers
);
routers.get(
  '/get-user-by-id/:_id',
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  userController.getUserById
);
routers.put(
  '/update-user/:_id',
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.updateUserSchema),
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  userController.updateUser
);
routers.delete('/lock-user/:_id',
  authMiddleware.adminMiddleware,
  authMiddleware.authMiddleware,
  userController.lockUser);
routers.patch('/unlock-user/:_id',
  authMiddleware.adminMiddleware,
  authMiddleware.authMiddleware,
  userController.unlockUser);
routers.delete(
  '/delete-user/:_id',
  authMiddleware.adminMiddleware,
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  userController.deleteUser
);
routers.post('/update-address/:_id',
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  validationHandler.validate(validationSchemas.updateUserSchema),
  validationHandler.validate(validationSchemas.updateAddressSchema),
  userController.updateAddress
);

routers.put('/edit-address/:_id/:address_id',
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  validationHandler.validate(validationSchemas.updateAddressSchema),
  userController.editAddress
);

routers.delete('/delete-address/:_id/:address_id',
  authMiddleware.authMiddleware,
  validationHandler.validate(validationSchemas.idParamSchema, 'params'),
  validationHandler.validate(validationSchemas.updateAddressSchema),
  userController.deleteAddress
);

routers.get('/me',
  authMiddleware.authMiddleware,
  userController.getMyProfile
);

module.exports = routers;