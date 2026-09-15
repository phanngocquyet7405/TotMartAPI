const productModel = require("../models/Product");
const brandModel = require("../models/Brand");
const categoryModel = require("../models/Category");
const cloudinary = require("cloudinary").v2;
const randomString = require("randomstring");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

class ProductController {
  async createProduct(req, res, next) {
    try {
      const validated = req.validatedBody;
      const brand = await brandModel.findById(validated.brand);
      const category = await categoryModel.findById(validated.category);

      const newProduct = new productModel(validated);
      newProduct.productId = randomString.generate({ length: 9 });
      newProduct.brand = brand._id;
      newProduct.category = category._id;
      newProduct.stock = validated.stock || 0;
      newProduct.instock = validated.stock > 0 ? true : false;
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
                { folder: "products/" + folderName, resource_type: "image" },
                (error, result) => {
                  if (error) return reject(error);
                  resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                  });
                },
              );
              stream.end(file.buffer);
            });
          }),
        );

        result = uploadResults;
      }
      newProduct.images = result;
      await newProduct.save();
      res.status(201).json({
        success: true,
        message: "Product created successfully",
        data: newProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllProducts(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
      const skip = (page - 1) * limit;
      const { keyword, category, brand, sort } = req.query;

      const filter = {};

      if (keyword) {
        filter.name = { $regex: keyword, $options: "i" };
      }

      if (category) filter.category = category;
      if (brand) filter.brand = brand;

      let sortCondition = { createdAt: -1 };
      if (sort === "price_asc") sortCondition = { price: 1 };
      if (sort === "price_desc") sortCondition = { price: -1 };

      const [products, total] = await Promise.all([
        productModel
          .find(filter)
          .populate("brand", "name logo")
          .populate("category", "name slug")
          .sort(sortCondition)
          .skip(skip)
          .limit(limit),
        productModel.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        message: "Products retrieved successfully",
        data: products,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProduct(req, res, next) {
    try {
      const { _id } = req.params;
      const validated = req.validatedBody;
      const getProduct = await productModel.findById(_id);
      if (req.files) {
        const uploadResults = await Promise.all(
          req.files.map((file) => {
            return new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                { folder: "products/" + req.body.name, resource_type: "image" },
                (error, result) => {
                  if (error) return reject(error);
                  resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                  });
                },
              );
              stream.end(file.buffer);
            });
          }),
        );
        for (let i = 0; i < req.files.length; i++) {
          const match = req.files[i].fieldname.match(/\d+/);
          if (getProduct.images[match[0]]) {
            await cloudinary.uploader.destroy(
              getProduct.images[match[0]].public_id,
            );
            getProduct.images[match[0]].url = uploadResults[i].url;
            getProduct.images[match[0]].public_id = uploadResults[i].public_id;
          }
        }
      }
      getProduct.name = validated.name || getProduct.name;
      getProduct.description = validated.description || getProduct.description;
      getProduct.price = validated.price || getProduct.price;
      getProduct.brand = validated.brand || getProduct.brand;
      getProduct.category = validated.category || getProduct.category;
      getProduct.stock = validated.stock || getProduct.stock;
      getProduct.instock = validated.stock > 0 ? true : false;
      await getProduct.save();
      res.status(200).json({
        success: true,
        message: "Product updated successfully",
        data: getProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteProduct(req, res, next) {
    try {
      const foundProduct = await productModel.findById(req.params._id);
      if (
        foundProduct &&
        foundProduct.images &&
        foundProduct.images.length > 0
      ) {
        const folderName =
          "products/" +
          foundProduct.name.trim().toLowerCase().replace(/\s+/g, "-");
        await cloudinary.api.delete_resources_by_prefix(folderName);
        await cloudinary.api.delete_folder(folderName);
        await productModel.findByIdAndDelete(req.params._id);
        return res.status(200).json({
          success: true,
          message: "Product deleted successfully",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductById(req, res, next) {
    try {
      const { _id } = req.params;
      const product = await productModel
        .findById(_id)
        .populate("brand")
        .populate("category");
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Product retrieved successfully",
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProductController();
