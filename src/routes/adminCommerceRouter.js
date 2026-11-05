const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationHandler');
const schema = require('../middleware/managerSchemas');
const adminCommerceController = require('../controllers/adminCommerceController');

const router = express.Router();
// Do not intercept existing /admin/notifications/stream, which authenticates with a one-use ticket.
router.use(['/gifts', '/merchants'], auth.authenticate);

router.post(
  '/merchants/:merchantId/brands',
  validate.validate(Joi.object({ merchantId: Joi.string().hex().length(24).required() }), 'params'),
  auth.requireAdmin,
  validate.validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() })),
  adminCommerceController.createMerchantBrand,
);

router.get('/gifts', auth.requireAdmin, adminCommerceController.listGifts);

router.post(
  '/gifts',
  auth.requireAdmin,
  validate.validate(schema.createGift),
  adminCommerceController.createGift,
);

router.patch(
  '/gifts/:id',
  validate.validate(schema.idParams, 'params'),
  auth.requireAdmin,
  validate.validate(schema.updateGift),
  adminCommerceController.updateGift,
);

router.delete(
  '/gifts/:id',
  validate.validate(schema.idParams, 'params'),
  auth.requireAdmin,
  adminCommerceController.deleteGift,
);

module.exports = router;
