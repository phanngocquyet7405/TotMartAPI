const brand = require("../models/Brand");
const productModel = require("../models/Product");
const { paginate } = require("../utils/pagination");

class BrandController {
  async createBrand(req, res, next) {
    try {
      const validated = req.validatedBody;
      const newBrand = new brand(validated);
      newBrand.ownerId = req.userId;
      await newBrand.save();
      res.status(201).json({
        success: true,
        message: "Brand created successfully",
        data: newBrand,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBrand(req, res, next) {
    try {
      const validated = req.validatedBody;
      const newData = {
        ...validated,
      };
      const updatedBrand = await brand.findByIdAndUpdate(
        req.params._id,
        newData,
        { new: true },
      );
      if (!updatedBrand) {
        return res.status(404).json({ message: "Brand not found" });
      }
      res.status(200).json({
        success: true,
        message: "Brand updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteBrand(req, res, next) {
    try {
      const products = await productModel.find({ brand: req.params._id });
      if (products.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete brand with associated products",
        });
      }

      const deletedBrand = await brand.findByIdAndDelete(req.params._id);
      if (!deletedBrand) {
        return res.status(404).json({
          success: false,
          message: "Brand not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Brand deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async getBrandProducts(req, res, next) {
    try {
      const brandId = req.params._id;
      const products = await productModel.find({ brand: brandId });
      res.status(200).json({
        success: true,
        message: "Products retrieved successfully",
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllBrands(req, res, next) {
    try {
      const { data, pagination } = await paginate(brand, req.query, {
        sort: { name: 1 },
      });

      res.status(200).json({
        success: true,
        message: "Brands retrieved successfully",
        data: data,
        pagination: pagination,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new BrandController();
