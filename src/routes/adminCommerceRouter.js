const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationHandler');
const schema = require('../middleware/managerSchemas');
const Box = require('../models/Box');
const Brand = require('../models/Brand');
const User = require('../models/User');
const service = require('../services/managerCatalogService');
const { changeDefinition } = require('../services/boxDefinitionService');
const router = express.Router();
// Do not intercept existing /admin/notifications/stream, which authenticates with a one-use ticket.
router.use(['/gifts', '/merchants'], auth.authenticate);
router.post('/merchants/:merchantId/brands',
  validate.validate(Joi.object({ merchantId: Joi.string().hex().length(24).required() }), 'params'),
  auth.requireAdmin,
  validate.validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() })),
  async (req, res) => {
    const owner = await User.findOne({ _id: req.params.merchantId, role: 'merchant', isActive: { $ne: false } });
    if (!owner) service.fail('Merchant không tồn tại hoặc bị khóa', 404);
    const data = await Brand.create({ name: req.validatedBody.name, ownerId: owner._id });
    res.status(201).json({ success: true, data });
  });
router.get('/gifts', auth.requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
  const filter = { archivedAt: null, isGift: true, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true } };
  const [data, total] = await Promise.all([Box.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Box.countDocuments(filter)]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});
router.post('/gifts', auth.requireAdmin, validate.validate(schema.createGift), async (req, res) => {
  const source = await Box.findOne({ _id: req.validatedBody.comboId, isGift: false, archivedAt: null, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true } });
  if (!source?.ownerId) service.fail('Combo nguồn cần gán chủ sở hữu đã xác minh trước khi tạo gift', 409);
  res.status(201).json({ success: true, data: await service.createGift(source.ownerId, req.validatedBody) });
});
router.patch('/gifts/:id', validate.validate(schema.idParams, 'params'), auth.requireAdmin, validate.validate(schema.updateGift), async (req, res) => {
  const gift = await Box.findOne({ _id: req.params.id, isGift: true, archivedAt: null });
  if (!gift) service.fail('Gift không tồn tại', 404);
  if (req.validatedBody.validTo && gift.sourceComboId) {
    const source = await Box.findById(gift.sourceComboId);
    if (!source || req.validatedBody.validTo > source.validTo) service.fail('Gift không được hết hạn sau combo nguồn');
  }
  res.json({ success: true, data: await changeDefinition(gift._id, req.validatedBody) });
});
router.delete('/gifts/:id', validate.validate(schema.idParams, 'params'), auth.requireAdmin, async (req, res) => {
  const gift = await Box.findOne({ _id: req.params.id, isGift: true, archivedAt: null });
  if (!gift) service.fail('Gift không tồn tại', 404);
  res.json({ success: true, data: await service.archiveBox(undefined, gift) });
});
module.exports = router;
