const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const User = require('../models/User');
function fail(message, statusCode = 403) { throw Object.assign(new Error(message), { statusCode }); }
// Direct ownership is authoritative. Brand ownership validates catalog references.
function ownerFilter(req) {
  if (req.user?.role !== 'merchant' || !req.userId) fail('Merchant required');
  return { ownerId: req.userId };
}
async function assertMerchant(ownerId) {
  if (!await User.exists({ _id: ownerId, role: 'merchant', isActive: { $ne: false } })) fail('Tài khoản merchant không tồn tại hoặc bị khóa', 400);
}
async function assertBrandAssignment(brandId, ownerId) {
  await assertMerchant(ownerId);
  const brand = await Brand.findById(brandId).select('ownerId');
  if (!brand) fail('Không tìm thấy thương hiệu', 404);
  if (String(brand.ownerId) === String(ownerId)) return;
  // Existing direct owners and obligations never transfer implicitly.
  if (await Product.exists({ brand: brandId, $or: [{ ownerId: { $ne: new mongoose.Types.ObjectId(ownerId) } }, { ownerId: { $exists: false } }] }))
    fail('Thương hiệu có sản phẩm chưa thuộc merchant này. Chạy migration hoặc xử lý chuyển chủ trước khi gán.', 409);
}
async function assertProductBrand(product, brandId) {
  if (!product.ownerId) {
    const previous = await Brand.findById(product.brand).select('ownerId');
    if (!previous?.ownerId) fail('Chủ sản phẩm legacy chưa xác minh; không được đổi brand', 409);
    product = { ownerId: previous.ownerId };
  }
  const brand = await Brand.findById(brandId).select('ownerId');
  if (!brand || String(brand.ownerId) !== String(product.ownerId))
    fail('Không được chuyển sản phẩm sang thương hiệu của chủ khác; chủ sản phẩm và nghĩa vụ đã bán được giữ nguyên.', 409);
}
function productFilters(query) {
  const filter = {}, keyword = String(query.keyword || query.search || '').trim().slice(0, 100);
  if (keyword) filter.name = { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  for (const key of ['brand', 'category']) if (query[key]) {
    if (!mongoose.isObjectIdOrHexString(query[key])) fail('ID bộ lọc không hợp lệ', 400);
    filter[key] = query[key];
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {};
    for (const [key, op] of [['minPrice', '$gte'], ['maxPrice', '$lte']]) if (query[key] !== undefined) {
      const value = Number(query[key]); if (!Number.isSafeInteger(value) || value < 0) fail('Khoảng giá không hợp lệ', 400);
      filter.price[op] = value;
    }
    if (filter.price.$gte > filter.price.$lte) fail('Khoảng giá không hợp lệ', 400);
  }
  return filter;
}
module.exports = { ownerFilter, assertMerchant, assertBrandAssignment, assertProductBrand, productFilters };
