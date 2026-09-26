const brand = require("../models/Brand");
const productModel = require("../models/Product");
const { paginate } = require("../utils/pagination");
const { uploadLogo, removeLogo } = require("../utils/brandLogoStorage");

class BrandController {
  async createBrand(req, res, next) {
    let uploaded;
    let saved = false;
    try {
      const validated = { ...req.validatedBody };
      if (req.file) {
        uploaded = await uploadLogo(req.file);
        validated.logo = uploaded.url;
        validated.logoPublicId = uploaded.publicId;
      }
      const newBrand = new brand(validated);
      newBrand.ownerId = req.userId;
      await newBrand.save();
      saved = true;
      res.status(201).json({
        success: true,
        message: "Brand created successfully",
        data: newBrand,
      });
    } catch (error) {
      if (uploaded && !saved) await removeLogo(uploaded.publicId);
      next(error);
    }
  }

  async updateBrand(req, res, next) {
    let uploaded;
    let saved = false;
    try {
      const validated = req.validatedBody;
      const newData = {
        ...validated,
      };
      if (req.file) {
        // Avoid uploading for a target that does not exist.
        if (!(await brand.exists({ _id: req.params._id }))) {
          return res.status(404).json({ message: "Brand not found" });
        }
        uploaded = await uploadLogo(req.file);
        newData.logo = uploaded.url;
        newData.logoPublicId = uploaded.publicId;
      }
      // Return the atomically replaced version so concurrent uploads each clean
      // up the correct preceding logo, rather than a stale pre-read image.
      const updatedBrand = await brand
        .findByIdAndUpdate(req.params._id, newData, {
          new: false,
          runValidators: true,
        })
        .select("+logoPublicId");
      if (!updatedBrand) {
        if (uploaded) await removeLogo(uploaded.publicId);
        return res.status(404).json({ message: "Brand not found" });
      }
      saved = true;
      if (uploaded) await removeLogo(updatedBrand.logoPublicId);
      res.status(200).json({
        success: true,
        message: "Brand updated successfully",
      });
    } catch (error) {
      if (uploaded && !saved) await removeLogo(uploaded.publicId);
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

      const deletedBrand = await brand
        .findByIdAndDelete(req.params._id)
        .select("+logoPublicId");
      if (!deletedBrand) {
        return res.status(404).json({
          success: false,
          message: "Brand not found",
        });
      }
      await removeLogo(deletedBrand.logoPublicId);
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
