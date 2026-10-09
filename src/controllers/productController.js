const Product = require('../models/Product');
const Brand = require('../models/Brand');
const Category = require('../models/Category');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const safeHtml = require('../utils/safeHtml');
const { fail } = require('../services/pricingService');
const logger = require('../utils/logger');
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
async function uploadFiles(files, uploaded) {
  // Sequential uploads allow cleanup even when a later file fails.
  for (const file of files || []) {
    const image = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'products', resource_type: 'image', format: 'webp', transformation: [{ width: 1600, crop: 'limit' }, { quality: 'auto' }] },
        (error, result) => error ? reject(error) : resolve({ url: result.secure_url, public_id: result.public_id }));
      stream.on('error', reject); stream.end(file.buffer);
    });
    uploaded.push(image);
  }
}
async function cleanup(images) {
  for (const image of images) { try { await cloudinary.uploader.destroy(image.public_id); } catch (err) { logger.error({ err, publicId: image.public_id }, 'Image cleanup requires retry'); } }
}
async function validateReferences(data) {
  if (data.brand !== undefined && !await Brand.exists({ _id: data.brand })) fail('Thương hiệu không tồn tại');
  if (data.category !== undefined && !await Category.exists({ _id: data.category })) fail('Danh mục không tồn tại');
}
function cleanData(data) { const result = { ...data }; delete result.existingImages; if (result.description !== undefined) result.description = safeHtml(result.description); return result; }
class ProductController {
  async createProduct(req, res, next) {
    const uploaded = []; let saved = false;
    try {
      const data = cleanData(req.validatedBody); await validateReferences(data);
      await uploadFiles(req.files, uploaded);
      const product = await Product.create({ ...data, productId: crypto.randomUUID(), stock: data.stock, instock: data.stock > 0, images: uploaded });
      saved = true; res.status(201).json({ success: true, data: product });
    } catch (err) { if (!saved) await cleanup(uploaded); next(err); }
  }
  async updateProduct(req, res, next) {
    const uploaded = []; let saved = false;
    try {
      const product = await Product.findById(req.params._id);
      if (!product) fail('Sản phẩm không tồn tại', 404);
      const data = cleanData(req.validatedBody); await validateReferences(data);
      const original = product.images.map(image => ({ url: image.url, public_id: image.public_id }));
      const submitted = req.validatedBody.existingImages;
      const retained = submitted === undefined ? original : original.filter(image => submitted.includes(image.public_id) || submitted.includes(image.url));
      // Legacy FE sent server-owned URLs. Unknown URLs/IDs never enter the stored image list.
      if (submitted?.some(id => !original.some(image => image.public_id === id || image.url === id))) fail('Danh sách ảnh không thuộc sản phẩm');
      await uploadFiles(req.files, uploaded);
      product.set(data); product.instock = product.stock > 0; product.images = [...retained, ...uploaded];
      await product.save(); saved = true;
      await cleanup(original.filter(image => !retained.some(keep => keep.public_id === image.public_id)));
      res.json({ success: true, data: product });
    } catch (err) { if (!saved) await cleanup(uploaded); next(err); }
  }
  async getAllProducts(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
      const filter = {}, keyword = String(req.query.keyword || req.query.search || '').trim().slice(0, 100);
      if (keyword) filter.name = { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      if (req.query.category) filter.category = req.query.category;
      if (req.query.brand) filter.brand = req.query.brand;
      if (req.query.brandSlug) { const brand = await Brand.findOne({ slug: req.query.brandSlug }); filter.brand = brand?._id || null; }
      if (req.query.minPrice !== undefined || req.query.maxPrice !== undefined) {
        filter.price = {};
        for (const [name, op] of [['minPrice', '$gte'], ['maxPrice', '$lte']]) if (req.query[name] !== undefined) { const value = Number(req.query[name]); if (!Number.isFinite(value) || value < 0) fail('Khoảng giá không hợp lệ'); filter.price[op] = value; }
      }
      const sort = req.query.sort === 'price_asc' ? { price: 1, _id: 1 } : req.query.sort === 'price_desc' ? { price: -1, _id: 1 } : { createdAt: -1, _id: -1 };
      if (['name','price','stock','createdAt'].includes(req.query.sortBy)) { for (const key of Object.keys(sort)) delete sort[key]; sort[req.query.sortBy] = req.query.sortDirection === 'asc' ? 1 : -1; sort._id = 1; }
      const [data, total] = await Promise.all([Product.find(filter).populate('brand', 'name logo').populate('category', 'name slug').sort(sort).skip((page - 1) * limit).limit(limit), Product.countDocuments(filter)]);
      res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
  }
  async getProductById(req, res, next) {
    try { const product = await Product.findById(req.params._id).populate('brand').populate('category'); if (!product) fail('Sản phẩm không tồn tại', 404); res.json({ success: true, data: product }); } catch (err) { next(err); }
  }
  async deleteProduct(req, res, next) {
    try {
      if (await require('../models/Box').exists({ 'products.productId': req.params._id })) fail('Sản phẩm đang thuộc hộp; gỡ khỏi hộp trước khi xóa', 409);
      const product = await Product.findByIdAndDelete(req.params._id); if (!product) fail('Sản phẩm không tồn tại', 404);
      await cleanup(product.images); res.json({ success: true, message: 'Đã xóa sản phẩm' });
    } catch (err) { next(err); }
  }
}
module.exports = new ProductController();
