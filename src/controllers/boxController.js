const { get } = require("mongoose");
const boxModel = require("../models/Box");
const cloudinary = require("cloudinary").v2;
const productModel = require("../models/Product");
const { paginate } = require("../utils/pagination");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

class BoxController {
  async createBox(req, res, next) {
    try {
      const validated = req.validatedBody;

      const productIds = validated.products.map((p) => p.productId);
      const productDocs = await productModel.find({ _id: { $in: productIds } });
      const productMap = new Map(
        productDocs.map((doc) => [doc._id.toString(), doc]),
      );

      const builtProducts = validated.products
        .map((item) => {
          const product = productMap.get(item.productId.toString());
          if (!product) return null;
          return {
            productId: product._id,
            quantity: item.quantity,
            price: product.price,
            name: product.name,
          };
        })
        .filter(Boolean);

      let result = [];
      const folderName = req.body.name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      if (req.files && req.files.length > 0) {
        const uploadResults = await Promise.all(
          req.files.map((file) => {
            return new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                {
                  folder: "Box Products/" + folderName,
                  resource_type: "image",
                  format: "webp", // [FIX]: Ép định dạng WebP giảm dung lượng
                  transformation: [
                    { width: 1024, crop: "limit" }, // [FIX]: Chặn ảnh quá khổ
                    { quality: "auto" },
                  ],
                },
                (error, result) => {
                  if (error) return reject(error);
                  resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                  });
                },
              );
              stream.on("error", reject);
              stream.write(file.buffer);
              stream.end();
            });
          }),
        );

        result = uploadResults;
      }

      const subtotal = builtProducts.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0,
      );
      const value =
        validated.discountPercent > 0
          ? subtotal * (1 - validated.discountPercent / 100)
          : subtotal;

      const { products, ...rest } = validated;
      const newBox = new boxModel({
        ...rest,
        products: builtProducts,
        result,
        validFrom: new Date(),
        validTo: new Date(validated.validTo),
        totalItem: builtProducts.length,
        value,
      });
      newBox.images = result;
      await newBox.save();
      res.status(201).json({
        success: true,
        message: "Box created successfully",
        data: newBox,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllBoxes(req, res, next) {
    try {
      // [FIX]: Áp dụng tiện ích phân trang để tránh Memory Leak
      const { data, pagination } = await paginate(
        boxModel,
        req.query,
        {},
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
      const box = await boxModel.findById(req.params._id);
      const products = [];
      box.products.forEach(async (product) => {
        let prd = await productModel.findById(product.productId);
        products.push({
          product: prd,
          quantity: product.quantity,
        });
      });
      box.products = products;
      res.status(200).json({
        success: true,
        message: "Box retrieved successfully",
        data: box,
        products: products,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBox(req, res, next) {
    try {
      const { _id } = req.params;
      const validated = req.validatedBody;

      const box = await boxModel.findById(_id);
      if (!box) {
        return res
          .status(404)
          .json({ success: false, message: "Box not found" });
      }

      if (req.files && req.files.length > 0) {
        const uploadResults = await Promise.all(
          req.files.map((file) => {
            return new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                {
                  folder: "Box Products/" + (validated.name || box.name),
                  resource_type: "image",
                  format: "webp",
                  transformation: [
                    { width: 1024, crop: "limit" },
                    { quality: "auto" },
                  ],
                },
                (error, result) => {
                  if (error) return reject(error);
                  resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                  });
                },
              );
              stream.on("error", reject);
              stream.write(file.buffer);
              stream.end();
            });
          }),
        );

        for (let i = 0; i < req.files.length; i++) {
          const match = req.files[i].fieldname.match(/\d+/);
          if (match && box.images[match[0]]) {
            await cloudinary.uploader.destroy(box.images[match[0]].public_id);
            box.images[match[0]].url = uploadResults[i].url;
            box.images[match[0]].public_id = uploadResults[i].public_id;
          }
        }
      }

      box.name = validated.name ?? box.name;
      box.descriptions = validated.descriptions ?? box.descriptions;
      box.stock = validated.stock ?? box.stock;
      box.isGift = validated.isGift ?? box.isGift;
      box.discountPercent = validated.discountPercent ?? box.discountPercent;
      if (validated.validTo) {
        box.validTo = new Date(validated.validTo);
      }

      if (validated.products !== undefined) {
        if (validated.products.length === 0) {
          box.products = [];
        } else {
          const productIds = validated.products.map((p) => p.productId);
          const productDocs = await productModel.find({
            _id: { $in: productIds },
          });
          const productMap = new Map(
            productDocs.map((doc) => [doc._id.toString(), doc]),
          );

          box.products = validated.products
            .map((item) => {
              const product = productMap.get(item.productId.toString());
              if (!product) return null;
              return {
                productId: product._id,
                quantity: item.quantity,
                price: product.price,
                name: product.name,
              };
            })
            .filter(Boolean);
        }
      }

      box.totalItem = box.products.length;
      const subtotal = box.products.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0,
      );
      box.value =
        box.discountPercent > 0
          ? subtotal * (1 - box.discountPercent / 100)
          : subtotal;

      await box.save();
      res.status(200).json({
        success: true,
        message: "Box updated successfully",
        data: box,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteBox(req, res, next) {
    try {
      const foundBox = await boxModel.findById(req.params._id);
      if (!foundBox) {
        return res
          .status(404)
          .json({ success: false, message: "Box not found" });
      }

      // [FIX]: Tránh xóa theo prefix Name (chống lỗi khi admin đổi tên). Xóa theo public_id.
      if (foundBox.images && foundBox.images.length > 0) {
        for (const img of foundBox.images) {
          if (img.public_id) {
            await cloudinary.uploader.destroy(img.public_id);
          }
        }
      }

      await boxModel.findByIdAndDelete(req.params._id);
      return res.status(200).json({
        success: true,
        message: "Box deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductsInBox(req, res, next) {
    try {
      const box = await boxModel.findById(req.params._id);
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
      const discountBox = await boxModel.find({ discountPercent: { $gt: 0 } });
      const newBox = await boxModel.find({
        isGift: true,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      const giftBox = await boxModel.find({ isGift: true });
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
}

module.exports = new BoxController();
