const express = require('express');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationHandler');
const schemas = require('../middleware/reconciliationSchemas');
const reconciliationController = require('../controllers/reconciliationController');

const router = express.Router();
router.use(auth.authenticate);

router.post(
  '/allocate',
  auth.requireAdmin,
  validate.validate(schemas.allocateSchema),
  reconciliationController.allocate,
);

router.post(
  '/refund-receipt',
  auth.requireAdmin,
  validate.validate(schemas.refundReceiptSchema),
  reconciliationController.refundReceipt,
);

router.get('/refunds', auth.requireAdmin, reconciliationController.listRefunds);

router.post(
  '/refunds/:_id/complete',
  validate.validate(schemas.idSchema, 'params'),
  auth.requireAdmin,
  validate.validate(schemas.completeSchema),
  reconciliationController.completeRefund,
);

router.get('/audit', auth.requireAdmin, reconciliationController.getAudit);

module.exports = router;
