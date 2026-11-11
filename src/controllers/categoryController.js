const category = require('../models/Category');
const productModel = require('../models/Product');

class CategoryController {
  async createCategory(req, res, next) {
    try {
      const validated = req.validatedBody;
      const newCategory = await category.create(validated);
      if (validated.childrenIds) {
        newCategory.childrenIds = validated.childrenIds.map((id) => ({ categoryId: id }));
        await newCategory.save();
      }
      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: newCategory,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateCategory(req, res, next) {
    try {
      const { _id } = req.params;
      const validated = req.validatedBody;

      // If updating childrenIds, convert to proper format
      if (validated.childrenIds && Array.isArray(validated.childrenIds)) {
        validated.childrenIds = validated.childrenIds.map((id) => ({ categoryId: id }));
      }

      const updatedCategory = await category.findByIdAndUpdate(_id, validated, { new: true });
      res.status(200).json({
        success: true,
        message: 'Category updated successfully',
        data: updatedCategory,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteCategory(req, res, next) {
    try {
      const { _id } = req.params;

      const products = await productModel.find({ category: _id });
      if (products.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete category with associated products',
        });
      }

      const parentCategory = await category.findOne({ 'childrenIds.categoryId': _id });
      if (parentCategory) {
        // Remove this category from parent's childrenIds
        parentCategory.childrenIds = parentCategory.childrenIds.filter(
          (child) => child.categoryId.toString() !== _id,
        );
        await parentCategory.save();
      }

      const deletedCategory = await category.findByIdAndDelete(_id);

      res.status(200).json({
        success: true,
        message: 'Category deleted successfully',
        data: deletedCategory,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllCategories(req, res, next) {
    try {
      const categories = await category.find().lean();
      res.status(200).json({
        success: true,
        message: 'Categories retrieved successfully',
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  async getCategoryById(req, res, next) {
    try {
      const { _id } = req.params;
      const categoryData = await category.findById(_id).lean();
      if (!categoryData) {
        return res.status(404).json({
          success: false,
          message: 'Category not found',
        });
      }
      res.status(200).json({
        success: true,
        message: 'Category retrieved successfully',
        data: categoryData,
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductsByCategory(req, res, next) {
    try {
      const { _id } = req.params;
      const products = await productModel.find({ category: _id });
      res.status(200).json({
        success: true,
        message: 'Products retrieved successfully',
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }

  async getRootCategory(req, res, next) {
    try {
      const rootCategories = await category.find({ 'childrenIds.0': { $exists: true } });
      res.status(200).json({
        success: true,
        message: 'Root categories retrieved successfully',
        data: rootCategories,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CategoryController();
