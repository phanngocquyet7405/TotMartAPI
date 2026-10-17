const mongoose = require('mongoose');
const Product = require('../models/Product');
const Brand = require('../models/Brand');
const Category = require('../models/Category');
const Box = require('../models/Box');
const Template = require('../models/SubscriptionTemplate');
const { changeDefinition, guardBox } = require('./boxDefinitionService');
const { prepaidPrice, planMonths } = require('./subscriptionService');
const safeHtml = require('../utils/safeHtml');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
async function productScope(ownerId, session = null) {
  const brands = await Brand.find({ ownerId }).select('_id').session(session);
  return { archivedAt: null, brand: { $in: brands.map(b => b._id) }, $or: [{ ownerId }, { ownerId: null }] };
}
async function requireProduct(ownerId, id) {
  const product = await Product.findOne({ ...await productScope(ownerId), _id: id });
  if (!product) fail('Sản phẩm không tồn tại trong cửa hàng', 404);
  return product;
}
async function requireBrand(ownerId, brandId) {
  if (!await Brand.exists({ _id: brandId, ownerId })) fail('Thương hiệu không thuộc cửa hàng', 403);
}
async function buildParts(ownerId, parts, session) {
  const scope = await productScope(ownerId, session);
  const docs = await Product.find({ ...scope, _id: { $in: parts.map(p => p.productId) } }).session(session);
  const map = new Map(docs.map(doc => [String(doc._id), doc]));
  if (docs.length !== parts.length) fail('Mọi sản phẩm cấu thành phải thuộc cửa hàng và còn tồn tại', 403);
  return parts.map(part => {
    const product = map.get(String(part.productId));
    return { productId: product._id, quantity: part.quantity, price: product.price, name: product.name };
  });
}
function boxPrice(products, percent = 0) {
  const base = products.reduce((n, p) => n + BigInt(p.price) * BigInt(p.quantity), 0n);
  if (base > BigInt(Number.MAX_SAFE_INTEGER)) fail('Giá combo vượt giới hạn');
  const value = Math.round(Number(base) * (1 - percent / 100));
  if (!Number.isSafeInteger(value) || value < 0) fail('Giá combo không hợp lệ');
  return value;
}
async function ownedBox(ownerId, id, { comboOnly = false, session = null } = {}) {
  const box = await Box.findOne({ _id: id, ownerId, archivedAt: null, internalSubscription: { $ne: true }, ...(comboOnly ? { isGift: false } : {}) }).session(session);
  if (!box) fail('Combo không thuộc cửa hàng hoặc không còn sử dụng được', 403);
  return box;
}
async function createCombo(ownerId, input, images = []) {
  let result;
  await mongoose.connection.transaction(async session => {
    const products = await buildParts(ownerId, input.products, session);
    [result] = await Box.create([{ ...input, ownerId, products, isGift: false, internalSubscription: false,
      validFrom: new Date(), descriptions: safeHtml(input.descriptions), totalItem: products.length,
      value: boxPrice(products, input.discountPercent), images }], { session });
  });
  return result;
}
async function createGift(ownerId, input) {
  let result;
  await mongoose.connection.transaction(async session => {
    // A shared write locks the source definition against concurrent edits/archive.
    await ownedBox(ownerId, input.comboId, { comboOnly: true, session });
    const source = await guardBox(input.comboId, session, { ownerId });
    if (source.isGift || source.internalSubscription || source.validFrom > new Date() || source.validTo < new Date()) fail('Nguồn gift phải là combo đang bán');
    await buildParts(ownerId, source.products, session);
    if (new Date(input.validTo) > source.validTo) fail('Gift không được hết hạn sau combo nguồn');
    [result] = await Box.create([{ ownerId, name: input.name, stock: input.stock, validFrom: new Date(), validTo: input.validTo,
      descriptions: source.descriptions, products: source.products.map(p => p.toObject()), value: source.value,
      discountPercent: source.discountPercent, totalItem: source.totalItem, images: source.images.map(i => i.toObject()),
      isGift: true, sourceComboId: source._id, sourceComboVersion: source.definitionVersion, giftPolicy: input.giftPolicy }], { session });
  });
  return result;
}
async function updateCombo(ownerId, box, input, images = []) {
  if (box.isGift || box.internalSubscription) fail('Dùng endpoint sửa gift cho loại này');
  if (input.products) await buildParts(ownerId, input.products, null);
  return changeDefinition(box._id, input, { ownerId, uploadedImages: images });
}
async function archiveBox(ownerId, box) {
  if (await Box.exists({ sourceComboId: box._id, archivedAt: null }) ||
      await Template.exists({ boxId: box._id, archivedAt: null })) fail('Combo đang là nguồn của gift hoặc gói; ngừng sử dụng nguồn trước', 409);
  return changeDefinition(box._id, {}, { ownerId, archive: true });
}
function presentTemplate(template) {
  const value = template.toObject ? template.toObject() : template;
  if (value.boxId?.value !== undefined) Object.assign(value, prepaidPrice(value.boxId.value, value.planType, value.discountPercent));
  value.description = safeHtml(value.description);
  value.totalDeliveries = planMonths(value.planType);
  value.billingMode = 'prepaid_full';
  return value;
}
async function createTemplate(ownerId, input, retail = false) {
  let result;
  await mongoose.connection.transaction(async session => {
    let box;
    if (retail) {
      const products = await buildParts(ownerId, input.products, session);
      [box] = await Box.create([{ ownerId, name: input.name, descriptions: safeHtml(input.description || input.name), products,
        stock: input.stock, validFrom: new Date(), validTo: input.validTo, totalItem: products.length,
        value: boxPrice(products), internalSubscription: true, isGift: false }], { session });
    } else {
      box = await guardBox(input.boxId, session, { ownerId });
      if (box.isGift || box.internalSubscription || box.validTo < new Date()) fail('Chọn combo hợp lệ cho gói');
      await buildParts(ownerId, box.products, session);
    }
    [result] = await Template.create([{ ownerId, sourceType: retail ? 'retail' : 'combo', name: input.name,
      description: safeHtml(input.description || ''), boxId: box._id, planType: input.planType,
      discountPercent: input.discountPercent, isActive: input.isActive ?? true,
      ...prepaidPrice(box.value, input.planType, input.discountPercent) }], { session });
  });
  return result;
}
async function updateTemplate(ownerId, id, input) {
  let result;
  await mongoose.connection.transaction(async session => {
    result = await Template.findOne({ _id: id, ownerId, archivedAt: null }).session(session);
    if (!result) fail('Gói không tồn tại trong cửa hàng', 404);
    if (input.boxId && result.sourceType === 'retail') fail('Không đổi nguồn của gói hàng lẻ');
    const box = await guardBox(input.boxId || result.boxId, session, { ownerId });
    if (box.isGift || (result.sourceType !== 'retail' && box.internalSubscription)) fail('Nguồn gói không hợp lệ');
    await buildParts(ownerId, box.products, session);
    for (const key of ['name', 'description', 'planType', 'discountPercent', 'isActive']) if (input[key] !== undefined) result[key] = input[key];
    result.description = safeHtml(result.description);
    result.boxId = box._id;
    Object.assign(result, prepaidPrice(box.value, result.planType, result.discountPercent));
    await result.save({ session });
  });
  return result;
}
async function catalogOptions(ownerId) {
  const [brands, categories] = await Promise.all([Brand.find({ ownerId }).select('_id name').lean(), Category.find({ isActive: { $ne: false } }).select('_id name').lean()]);
  return { brands, categories };
}
module.exports = { productScope, requireProduct, requireBrand, buildParts, ownedBox, createCombo, createGift,
  updateCombo, archiveBox, createTemplate, updateTemplate, presentTemplate, catalogOptions, fail };
