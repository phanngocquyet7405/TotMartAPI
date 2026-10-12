const express = require('express');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationHandler');
const schemas = require('../middleware/reconciliationSchemas');
const service = require('../services/paymentReconciliationService');
const Refund = require('../models/ReceiptRefund');
const Audit = require('../models/PaymentAudit');
const { fail } = require('../services/paymentPolicy');
const router = express.Router();
router.use(auth.authMiddleware, auth.adminMiddleware);
function commandKey(req, action) {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('Idempotency-Key 16–128 ký tự là bắt buộc', 400);
  return `admin:${req.userId}:${action}:${key}`;
}
router.post('/allocate', validate.validate(schemas.allocateSchema), async (req, res, next) => {
  try { res.json({ success: true, data: await service.applyReceipts({ ...req.validatedBody,
    key: commandKey(req, 'allocate'), actorId: req.userId, source: 'admin' }) }); } catch (err) { next(err); }
});
router.post('/refund-receipt', validate.validate(schemas.refundReceiptSchema), async (req, res, next) => {
  try { res.json({ success: true, data: await service.refundReceipt({ ...req.validatedBody,
    key: commandKey(req, 'refund-receipt'), actorId: req.userId }) }); } catch (err) { next(err); }
});
router.get('/refunds', async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1)), limit = 50;
    const filter = { status: 'pending' };
    const [data, total] = await Promise.all([Refund.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit), Refund.countDocuments(filter)]);
    res.json({ success: true, data, pagination: { page, limit, total } });
  } catch (err) { next(err); }
});
router.post('/refunds/:_id/complete', validate.validate(schemas.idSchema, 'params'),
  validate.validate(schemas.completeSchema), async (req, res, next) => {
    try { res.json({ success: true, data: await service.completeRefund({ ...req.validatedBody,
      refundId: req.params._id, key: commandKey(req, 'complete'), actorId: req.userId }) }); } catch (err) { next(err); }
  });
router.get('/audit', async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const data = await Audit.find().sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});
module.exports = router;
