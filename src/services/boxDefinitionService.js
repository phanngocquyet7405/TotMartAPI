const mongoose = require('mongoose');
const Box = require('../models/Box');
const BoxVersion = require('../models/BoxVersion');
const Subscription = require('../models/UserSubscription');
const Order = require('../models/Order');
const Product = require('../models/Product');
const safeHtml = require('../utils/safeHtml');
function fail(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode });
}
function requireTransaction(session) {
  if (!session?.inTransaction()) throw new Error('Box operation requires an active transaction');
}
async function guardBox(boxId, session, { ownerId } = {}) {
  requireTransaction(session);
  if (!mongoose.isObjectIdOrHexString(boxId)) fail('Box ID không hợp lệ', 400);
  // Shared write serializes pinning against edits/archive, including read predicates.
  const box = await Box.findOneAndUpdate({ _id: boxId, archivedAt: null, ...(ownerId ? { ownerId } : {}) },
    { $inc: { obligationRevision: 1 } }, { new: true, session });
  if (!box) fail('Box không tồn tại hoặc đã lưu trữ', 404);
  if (!Number.isSafeInteger(box.definitionVersion) || box.definitionVersion < 1)
    fail('Box chưa được migration version');
  return box;
}
function definition(box) {
  return {
    name: box.name, descriptions: safeHtml(box.descriptions),
    products: box.products.map(p => ({ productId: p.productId,
      quantity: p.quantity, price: p.price, name: p.name || box.name })),
    value: box.value, totalItem: box.totalItem, isGift: box.isGift,
    discountPercent: box.discountPercent, validFrom: box.validFrom, validTo: box.validTo,
    images: box.images.map(i => ({ url: i.url, public_id: i.public_id })),
  };
}
async function ensureVersion(box, session) {
  let snapshot = await BoxVersion.findOne({ boxId: box._id, version: box.definitionVersion }).session(session);
  if (!snapshot) [snapshot] = await BoxVersion.create([{ boxId: box._id,
    version: box.definitionVersion, definition: definition(box) }], { session });
  return snapshot;
}
async function pinBox(boxId, session, { kind = 'main' } = {}) {
  const box = await guardBox(boxId, session);
  const now = new Date();
  if (!box.products.length || (kind === 'main' && box.isGift) ||
      (kind === 'gift' && !box.isGift) || box.validFrom > now || box.validTo < now)
    fail('Box không hợp lệ cho subscription');
  const snapshot = await ensureVersion(box, session);
  return { box, version: snapshot };
}
async function assertEditable(boxId, session) {
  // Deliberately protects ANY paid subscription, including historical ones.
  const sub = await Subscription.exists({
    $or: [{ boxId }, { 'gift.boxId': boxId }],
    $and: [{ $or: [{ paymentStatus: 'paid' }, { status: { $in: ['pending_payment', 'active'] } }] }],
  }).session(session);
  if (sub) fail('Box đang gắn với subscription; hãy tạo Box mới thay vì sửa/xóa');
  // Pending/paid product orders also need this identity and stock for reserve/restore.
  if (await Order.exists({ 'boxes.boxId': boxId,
    status: { $nin: ['cancelled', 'returned'] } }).session(session))
    fail('Box đang gắn với đơn hàng chưa kết thúc');
}
async function applyPatch(box, input, uploadedImages, session) {
  const allowed = new Set(['name', 'descriptions', 'validFrom', 'validTo',
    'isGift', 'discountPercent', 'products', 'existingImages', 'stock', 'giftPolicy']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`Field không được phép: ${key}`, 400);
  for (const key of ['name', 'validFrom', 'validTo', 'isGift', 'discountPercent'])
    if (input[key] !== undefined) box[key] = input[key];
  if (input.descriptions !== undefined) box.descriptions = safeHtml(input.descriptions);
  if (input.giftPolicy !== undefined) {
    if (!box.isGift) fail('Chỉ gift có chính sách quà', 400);
    box.giftPolicy = input.giftPolicy;
  }
  if (box.validFrom > box.validTo) fail('Ngày kết thúc phải sau ngày bắt đầu', 400);
  if (input.products !== undefined) {
    if (!input.products.length) fail('Box cần ít nhất một sản phẩm', 400);
    const docs = await Product.find({ _id: { $in: input.products.map(p => p.productId) } }).session(session);
    const map = new Map(docs.map(p => [String(p._id), p]));
    box.products = input.products.map(p => {
      const product = map.get(String(p.productId));
      if (!product) fail('Sản phẩm trong Box không tồn tại', 400);
      if (!Number.isSafeInteger(p.quantity) || p.quantity < 1) fail('Số lượng cấu phần không hợp lệ', 400);
      return { productId: product._id, quantity: p.quantity, price: product.price, name: product.name };
    });
  }
  if (input.existingImages !== undefined) {
    const retained = new Set(input.existingImages.map(i => i.public_id));
    const owned = new Set(box.images.map(i => i.public_id));
    if ([...retained].some(id => !owned.has(id))) fail('Ảnh không thuộc Box', 400);
    box.images = box.images.filter(i => retained.has(i.public_id));
  }
  box.images.push(...uploadedImages);
  const subtotal = box.products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  box.value = Math.round(subtotal * (1 - box.discountPercent / 100));
  if (!Number.isSafeInteger(box.value) || box.value < 0) fail('Giá Box không hợp lệ', 400);
  box.totalItem = box.products.length;
  // stock ignored: only atomic stock adjustment/inventory services may change it.
}
async function changeDefinition(boxId, input, { archive = false, uploadedImages = [], ownerId } = {}) {
  let result;
  await mongoose.connection.transaction(async session => {
    const box = await guardBox(boxId, session, { ownerId });
    await assertEditable(box._id, session);
    await ensureVersion(box, session);
    if (archive) box.archivedAt = new Date();
    else {
      await applyPatch(box, input, uploadedImages, session);
      box.definitionVersion += 1;
    }
    await box.save({ session });
    if (!archive) await ensureVersion(box, session);
    result = box;
  });
  return result;
}
async function loadPinnedVersion(boxId, versionId, session) {
  if (!versionId) fail('Subscription chưa có BoxVersion; cần kiểm tra dữ liệu legacy');
  const snapshot = await BoxVersion.findOne({ _id: versionId, boxId }).session(session);
  if (!snapshot?.definition?.products.length) fail('BoxVersion không hợp lệ');
  return snapshot.definition;
}
module.exports = { guardBox, pinBox, changeDefinition, loadPinnedVersion };
