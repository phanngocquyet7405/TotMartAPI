const Box = require('../models/Box');
const Brand = require('../models/Brand');
const User = require('../models/User');
const service = require('../services/managerCatalogService');
const { changeDefinition } = require('../services/boxDefinitionService');

class AdminCommerceController {
  async createMerchantBrand(req, res, next) {
    try {
      const owner = await User.findOne({
        _id: req.params.merchantId,
        role: 'merchant',
        isActive: { $ne: false },
      });
      if (!owner) service.fail('Merchant không tồn tại hoặc bị khóa', 404);
      const data = await Brand.create({ name: req.validatedBody.name, ownerId: owner._id });
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async listGifts(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
      const filter = {
        archivedAt: null,
        isGift: true,
        internalSubscription: { $ne: true },
        subscriptionOnly: { $ne: true },
      };
      const [data, total] = await Promise.all([
        Box.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Box.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }

  async createGift(req, res, next) {
    try {
      const source = await Box.findOne({
        _id: req.validatedBody.comboId,
        isGift: false,
        archivedAt: null,
        internalSubscription: { $ne: true },
        subscriptionOnly: { $ne: true },
      });
      if (!source?.ownerId)
        service.fail('Combo nguồn cần gán chủ sở hữu đã xác minh trước khi tạo gift', 409);
      res.status(201).json({
        success: true,
        data: await service.createGift(source.ownerId, req.validatedBody),
      });
    } catch (err) {
      next(err);
    }
  }

  async updateGift(req, res, next) {
    try {
      const gift = await Box.findOne({ _id: req.params.id, isGift: true, archivedAt: null });
      if (!gift) service.fail('Gift không tồn tại', 404);
      if (req.validatedBody.validTo && gift.sourceComboId) {
        const source = await Box.findById(gift.sourceComboId);
        if (!source || req.validatedBody.validTo > source.validTo)
          service.fail('Gift không được hết hạn sau combo nguồn');
      }
      res.json({ success: true, data: await changeDefinition(gift._id, req.validatedBody) });
    } catch (err) {
      next(err);
    }
  }

  async deleteGift(req, res, next) {
    try {
      const gift = await Box.findOne({ _id: req.params.id, isGift: true, archivedAt: null });
      if (!gift) service.fail('Gift không tồn tại', 404);
      res.json({ success: true, data: await service.archiveBox(undefined, gift) });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminCommerceController();
