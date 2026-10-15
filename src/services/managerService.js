const mongoose = require('mongoose');
const Product = require('../models/Product');
const Box = require('../models/Box');
const Template = require('../models/SubscriptionTemplate');
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
async function checkProducts(items, ownerId) {
  const ids = [...new Set(items.map(p => String(p.productId)))];
  if (await Product.countDocuments({ _id: { $in: ids }, ownerId, archivedAt: null }) !== ids.length)
    fail('Chỉ được chọn sản phẩm đang bán của bạn', 403);
}

async function createRetailSubscription(input, ownerId) {
  let template;
  await mongoose.connection.transaction(async session => {
    const docs = await Product.find({ _id: { $in: input.products.map(p => p.productId) }, ownerId: ownerId, archivedAt: null }).session(session);
    const map = new Map(docs.map(p => [String(p._id), p]));
    const parts = input.products.map(p => { const product = map.get(p.productId); if (!product) fail('Sản phẩm không còn khả dụng', 409); return { ...p, name: product.name, price: product.price }; });
    const value = parts.reduce((sum, p) => sum + p.price * p.quantity, 0);
    if (!Number.isSafeInteger(value) || value < 1) fail('Giá gói không hợp lệ');
    const [box] = await Box.create([{ ownerId: ownerId, name: input.name, descriptions: input.description || input.name, products: parts, totalItem: parts.length, value, stock: input.stock, validFrom: new Date(), validTo: input.validTo, subscriptionOnly: true }], { session });
    const price = require('../services/subscriptionService').prepaidPrice(value, input.planType, input.discountPercent);
    [template] = await Template.create([{ ownerId: ownerId, name: input.name, description: input.description, boxId: box._id, planType: input.planType, discountPercent: input.discountPercent, sourceType: 'retail', ...price }], { session });
  });
  return template;
}
async function createGift(validated, ownerId) {
  let gift;
  await mongoose.connection.transaction(async session => {
    const combo = await require('../services/boxDefinitionService').guardBox(validated.comboId, session);
    if (String(combo.ownerId) !== ownerId || combo.isGift || combo.subscriptionOnly) fail('Combo không thuộc bạn', 403);
    await checkProducts(combo.products, ownerId);
    const { comboId, ...input } = validated;
    [gift] = await Box.create([{ ...input, ownerId: ownerId, sourceComboId: combo._id, isGift: true,
      descriptions: combo.descriptions, products: combo.products.map(p => p.toObject()), value: combo.value,
      discountPercent: combo.discountPercent, totalItem: combo.totalItem, images: combo.images.map(i => i.toObject()), validFrom: new Date() }], { session });
  });
  return gift;
}
module.exports = { checkProducts, createRetailSubscription, createGift };
