const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationHandler');
const schemas = require('../middleware/validationSchemas');
const Product = require('../models/Product');
const Box = require('../models/Box');
const Template = require('../models/SubscriptionTemplate');
const Brand = require('../models/Brand');
const Order = require('../models/Order');
const products = require('../controllers/productController');
const boxes = require('../controllers/boxController');
const templates = require('../controllers/subscriptionTemplateController');
const upload = require('../middleware/uploadMiddleware');
const router = express.Router();
const run = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
router.use(auth.authMiddleware, (req, res, next) => {
  if (req.user.role !== 'merchant') return res.status(403).json({ success: false, message: 'Chỉ merchant được truy cập manager' });
  next();
});
const own = Model => run(async (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params._id)) fail('ID không hợp lệ');
  if (!await Model.exists({ _id: req.params._id, ...require('../services/merchantScope').ownerFilter(req) })) fail('Không tìm thấy dữ liệu của bạn', 404);
  next();
});
async function checkProducts(items, ownerId) {
  const ids = [...new Set(items.map(p => String(p.productId)))];
  if (await Product.countDocuments({ _id: { $in: ids }, ownerId, archivedAt: null }) !== ids.length)
    fail('Chỉ được chọn sản phẩm đang bán của bạn', 403);
}
const references = run(async (req, res, next) => {
  const data = req.validatedBody;
  if (data.products) await checkProducts(data.products, req.userId);
  if (data.brand && !await Brand.exists({ _id: data.brand, ownerId: req.userId })) fail('Thương hiệu không thuộc bạn', 403);
  if (data.boxId) {
    const combo = await Box.findOne({ _id: data.boxId, ownerId: req.userId, archivedAt: null, isGift: false });
    if (!combo) fail('Combo không thuộc bạn', 403);
    await checkProducts(combo.products, req.userId);
  }
  for (const gift of data.gift || []) if (!await Box.exists({ _id: gift.boxId, ownerId: req.userId, archivedAt: null, isGift: true })) fail('Gift không thuộc bạn', 403);
  next();
});
const parseProducts = (req, res, next) => {
  if (typeof req.body.products === 'string') { try { req.body.products = JSON.parse(req.body.products); } catch { return res.status(400).json({ success: false, message: 'Danh sách sản phẩm không hợp lệ' }); } }
  next();
};
const list = Model => run(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { ...require('../services/merchantScope').ownerFilter(req), ...(Model === Product || Model === Box ? { archivedAt: null } : {}) };
  if (Model === Box && req.query.kind === 'combo') Object.assign(filter, { isGift: false, subscriptionOnly: { $ne: true } });
  if (Model === Box && req.query.kind === 'gift') Object.assign(filter, { isGift: true, sourceComboId: { $ne: null } });
  if (Model === Product) Object.assign(filter, require('../services/merchantScope').productFilters(req.query));
  const [data, total] = await Promise.all([Model.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Model.countDocuments(filter)]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});
router.get('/products', list(Product));
router.get('/combos', list(Box));
router.get('/subscriptions', list(Template));
router.get('/catalog-options', run(async (req, res) => {
  const [brands, categories] = await Promise.all([Brand.find({ ownerId: req.userId }).select('name'), require('../models/Category').find().select('name')]);
  res.json({ success: true, data: { brands, categories } });
}));
router.post('/products', upload.array('images', 10), validate.validate(schemas.productSchema), references, products.createProduct);
router.put('/products/:_id', own(Product), upload.array('images', 10), validate.validate(schemas.productUpdateSchema), references, products.updateProduct);
router.delete('/products/:_id', own(Product), products.deleteProduct);
router.patch('/products/:_id/stock', own(Product), validate.validate(schemas.adjustStockSchema), products.adjustStock);
router.post('/combos', upload.boxUpload.array('images', 10), parseProducts, validate.validate(schemas.createBoxSchema.keys({ isGift: Joi.boolean().valid(false).default(false) })), references, boxes.createBox);
router.put('/combos/:_id', own(Box), upload.boxUpload.array('images', 10), parseProducts, validate.validate(schemas.updateBoxSchema.keys({ isGift: Joi.forbidden() })), references, boxes.updateBox);
router.delete('/combos/:_id', own(Box), boxes.deleteBox);
router.patch('/combos/:_id/stock', own(Box), validate.validate(schemas.adjustStockSchema), boxes.adjustStock);
router.post('/subscriptions', validate.validate(schemas.createSubscriptionTemplateSchema), references, templates.createTemplate);
router.patch('/subscriptions/:_id', own(Template), validate.validate(schemas.updateSubscriptionTemplateSchema), references, (req, res, next) => { req.params.id = req.params._id; next(); }, templates.updateTemplate);
router.delete('/subscriptions/:_id', own(Template), (req, res, next) => { req.params.id = req.params._id; next(); }, templates.deleteTemplate);
// Retail subscriptions reuse the existing versioned monthly delivery engine.
router.post('/retail-subscriptions', validate.validate(Joi.object({
  name: Joi.string().min(3).max(100).required(), description: Joi.string().max(500).default(''),
  products: schemas.createBoxSchema.extract('products'), stock: Joi.number().integer().min(0).required(),
  validTo: Joi.date().greater('now').required(), planType: schemas.createSubscriptionTemplateSchema.extract('planType'),
  discountPercent: Joi.number().min(0).max(100).default(0),
})), references, run(async (req, res) => {
  const input = req.validatedBody;
  let template;
  await mongoose.connection.transaction(async session => {
    const docs = await Product.find({ _id: { $in: input.products.map(p => p.productId) }, ownerId: req.userId, archivedAt: null }).session(session);
    const map = new Map(docs.map(p => [String(p._id), p]));
    const parts = input.products.map(p => { const product = map.get(p.productId); if (!product) fail('Sản phẩm không còn khả dụng', 409); return { ...p, name: product.name, price: product.price }; });
    const value = parts.reduce((sum, p) => sum + p.price * p.quantity, 0);
    if (!Number.isSafeInteger(value) || value < 1) fail('Giá gói không hợp lệ');
    const [box] = await Box.create([{ ownerId: req.userId, name: input.name, descriptions: input.description || input.name, products: parts, totalItem: parts.length, value, stock: input.stock, validFrom: new Date(), validTo: input.validTo, subscriptionOnly: true }], { session });
    const price = require('../services/subscriptionService').prepaidPrice(value, input.planType, input.discountPercent);
    [template] = await Template.create([{ ownerId: req.userId, name: input.name, description: input.description, boxId: box._id, planType: input.planType, discountPercent: input.discountPercent, sourceType: 'retail', ...price }], { session });
  });
  res.status(201).json({ success: true, data: template });
}));
router.get('/orders', run(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 20;
  const filter = { merchantId: req.userId };
  const [data, total] = await Promise.all([Order.find(filter).select('orderId products status totalAmount shippingAddress paymentMethod paymentStatus createdAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Order.countDocuments(filter)]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));
const giftInput = Joi.object({
  name: Joi.string().min(3).max(100).required(), comboId: Joi.string().hex().length(24).required(),
  stock: Joi.number().integer().min(0).required(), validTo: Joi.date().greater('now').required(),
  giftPolicy: require('../services/giftPolicy').schema.required(),
});
router.post('/gifts', validate.validate(giftInput), run(async (req, res) => {
  let gift;
  await mongoose.connection.transaction(async session => {
    const combo = await require('../services/boxDefinitionService').guardBox(req.validatedBody.comboId, session);
    if (String(combo.ownerId) !== req.userId || combo.isGift || combo.subscriptionOnly) fail('Combo không thuộc bạn', 403);
    await checkProducts(combo.products, req.userId);
    const { comboId, ...input } = req.validatedBody;
    [gift] = await Box.create([{ ...input, ownerId: req.userId, sourceComboId: combo._id, isGift: true,
      descriptions: combo.descriptions, products: combo.products.map(p => p.toObject()), value: combo.value,
      discountPercent: combo.discountPercent, totalItem: combo.totalItem, images: combo.images.map(i => i.toObject()), validFrom: new Date() }], { session });
  });
  res.status(201).json({ success: true, data: gift });
}));
router.patch('/gifts/:_id', own(Box), validate.validate(Joi.object({
  name: Joi.string().min(3).max(100), giftPolicy: require('../services/giftPolicy').schema,
  validTo: Joi.date().greater('now'),
}).min(1)), run(async (req, res) => {
  const box = await Box.findOne({ _id: req.params._id, ownerId: req.userId, isGift: true, sourceComboId: { $ne: null } });
  if (!box) fail('Không tìm thấy gift', 404);
  const data = await require('../services/boxDefinitionService').changeDefinition(box._id, req.validatedBody);
  res.json({ success: true, data });
}));
module.exports = router;
