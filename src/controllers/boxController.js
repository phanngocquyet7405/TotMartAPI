const { changeDefinition } = require("../services/boxDefinitionService");
const boxModel = require("../models/Box");
const cloudinary = require("cloudinary").v2;
const productModel = require("../models/Product");
const { paginate } = require("../utils/pagination");
const logger = require("../utils/logger");
const { adjustStock } = require("../services/stockAdjustment");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

class BoxController {
  async getPublicBox(req, res, next) {
    try {
      const now = new Date();
      const box = await boxModel
        .findOne({
          _id: req.params._id,
          archivedAt: null,
          $or: [{ isGift: false }, { isGift: true, sourceComboId: { $ne: null } }],
          internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true },
          validFrom: { $lte: now },
          validTo: { $gte: now },
        })
        .select(
          "name stock descriptions validFrom validTo products totalItem value images discountPercent isGift giftPolicy sourceComboId",
        );
      if (!box)
        return res
          .status(404)
          .json({ success: false, message: "Box not available" });
      const data = box.toObject();
      data.descriptions = require("../utils/safeHtml")(data.descriptions);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
  async createBox(req, res, next) {
    const uploaded = [];
    let committed = false;
    try {
      for (const file of req.files || []) {
        const image = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'Box Products', resource_type: 'image', format: 'webp' },
            (err, result) => err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id }));
          stream.on('error', reject);
          stream.end(file.buffer);
        });
        uploaded.push(image);
      }
      const { ownerId, ...input } = req.validatedBody;
      const box = await require('../services/managerCatalogService').createCombo(ownerId, input, uploaded);
      committed = true;
      res.status(201).json({ success: true, data: box });
    } catch (error) {
      if (!committed) await Promise.allSettled(uploaded.map(image => cloudinary.uploader.destroy(image.public_id)));
      next(error);
    }
  }

  async getAllBoxes(req, res, next) {
    try {
      // [FIX]: Áp dụng tiện ích phân trang để tránh Memory Leak
      const { data, pagination } = await paginate(
        boxModel,
        req.query,
        { archivedAt: null, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true },
          ...(req.query.available === 'true' ? { validFrom: { $lte: new Date() }, validTo: { $gte: new Date() }, stock: { $gt: 0 } } : {}),
          ...(['combo', 'gift'].includes(req.query.kind || req.query.type) ? { isGift: (req.query.kind || req.query.type) === 'gift' } : {}) },
        { sort: { createdAt: -1 } },
      );

      res.status(200).json({
        success: true,
        message: "Boxes retrieved successfully",
        data: data,
        pagination: pagination, // Trả về thông tin phân trang cho frontend
      });
    } catch (error) {
      next(error);
    }
  }

  async getBoxById(req, res, next) {
    try {
      const box = await boxModel.findOne({
        _id: req.params._id,
        archivedAt: null,
      });
      if (!box)
        return res
          .status(404)
          .json({ success: false, message: "Box not found" });
      res.status(200).json({
        success: true,
        message: "Box retrieved successfully",
        data: box,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBox(req, res, next) {
    const uploaded = [];
    let committed = false;
    try {
      // Upload outside MongoDB transaction: transaction callback may run again.
      // Sequential uploads let us track successful assets even if a later upload fails.
      for (const file of req.files || []) {
        const image = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "Box Products/" + req.params._id,
              resource_type: "image",
              format: "webp",
              transformation: [
                { width: 1024, crop: "limit" },
                { quality: "auto" },
              ],
            },
            (error, result) =>
              error
                ? reject(error)
                : resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                  }),
          );
          stream.on("error", reject);
          stream.end(file.buffer);
        });
        uploaded.push(image);
      }
      const box = await changeDefinition(req.params._id, req.validatedBody, {
        uploadedImages: uploaded,
      });
      committed = true;
      res.json({
        success: true,
        message: "Box updated successfully",
        data: box,
      });
    } catch (error) {
      for (const image of committed ? [] : uploaded) {
        await cloudinary.uploader
          .destroy(image.public_id)
          .catch((err) =>
            logger.error(
              { err, publicId: image.public_id },
              "New Box image cleanup failed",
            ),
          );
      }
      next(error);
    }
  }

  async deleteBox(req, res, next) {
    try {
      await changeDefinition(req.params._id, {}, { archive: true });
      // Keep existing images: historical snapshots still reference them.
      res.json({ success: true, message: "Box archived successfully" });
    } catch (error) {
      next(error);
    }
  }

  async getProductsInBox(req, res, next) {
    try {
      const box = await boxModel.findOne({
        _id: req.params._id,
        archivedAt: null,
        internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true },
      });
      if (!box) {
        return res.status(404).json({
          success: false,
          message: "Box not found",
        });
      }
      const products = [];
      for (const item of box.products) {
        const product = await productModel.findById(item.productId);
        if (product) {
          products.push({
            product: product,
            quantity: item.quantity,
          });
        }
      }
      res.status(200).json({
        success: true,
        message: "Products in box retrieved successfully",
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBoxOfferDicountCoupons(req, res, next) {
    try {
      const discountBox = await boxModel.find({
        archivedAt: null,
        internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true },
        discountPercent: { $gt: 0 },
      });
      const newBox = await boxModel.find({
        archivedAt: null,
        isGift: true,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      const giftBox = await boxModel.find({ archivedAt: null, isGift: true });
      res.status(200).json({
        success: true,
        message: "Discount boxes retrieved successfully",
        data: {
          discountBoxes: discountBox,
          newBoxes: newBox,
          giftBoxes: giftBox,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async adjustStock(req, res, next) {
    try {
      const { delta, reason } = req.validatedBody;
      const box = await adjustStock(boxModel, req.params._id, delta, {
        notFoundMessage: "Hộp không tồn tại",
      });
      logger.info(
        {
          userId: req.userId,
          boxId: String(box._id),
          delta,
          stock: box.stock,
          reason: reason || undefined,
        },
        "Box stock adjusted",
      );
      res.json({
        success: true,
        message: "Điều chỉnh tồn kho thành công",
        data: { _id: box._id, stock: box.stock },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BoxController();
