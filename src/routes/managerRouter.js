const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/authMiddleware');
const schemas = require('../middleware/managerSchemas');
const upload = require('../middleware/uploadMiddleware');
const catalog = require('../services/managerCatalogService');
const product = require('../controllers/productController');
const controller = require('../controllers/managerController');
const router = express.Router();
router.use(auth.authMiddleware, (req, res, next) => {
  if (req.user.role !== 'merchant') return res.status(403).json({ success: false, message: 'Khu vực dành riêng cho merchant' });
  req.managerId = req.userId;
  next();
});
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[source], { abortEarly: false, stripUnknown: false });
    if (error) return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message })) });
    if (source === 'body') req.validatedBody = value;
    next();
  };
}
function parseMultipart(req, res, next) {
  for (const key of ['products', 'giftPolicy']) if (typeof req.body?.[key] === 'string') {
    try { req.body[key] = JSON.parse(req.body[key]); }
    catch { return res.status(400).json({ success: false, message: `${key} cần JSON hợp lệ` }); }
  }
  next();
}
const id = validate(schemas.idParams, 'params');
async function ownProduct(req, res, next) {
  await catalog.requireProduct(req.userId, req.params.id);
  req.params._id = req.params.id;
  next();
}
async function ownReferences(req, res, next) {
  if (req.validatedBody.brand) await catalog.requireBrand(req.userId, req.validatedBody.brand);
  if (req.validatedBody.category && !await require('../models/Category').exists({ _id: req.validatedBody.category, isActive: { $ne: false } })) catalog.fail('Danh mục không tồn tại hoặc đã ngừng sử dụng');
  next();
}
router.get('/catalog-options', controller.options);
router.post('/brands', validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() })), controller.createBrand);
router.get('/products', controller.products);
router.post('/products', upload.array('images', 10), validate(schemas.createProduct), ownReferences, product.createProduct);
router.put('/products/:id', id, ownProduct, upload.array('images', 10),
  (req, res, next) => validate(req.files?.length ? schemas.updateProduct.min(0) : schemas.updateProduct)(req, res, next), ownReferences, product.updateProduct);
router.patch('/products/:id/stock', id, validate(schemas.stock), controller.productStock);
router.delete('/products/:id', id, ownProduct, product.deleteProduct);
router.get('/combos', controller.combos);
router.post('/combos', upload.array('images', 10), parseMultipart, validate(schemas.createCombo), controller.createCombo);
router.put('/combos/:id', id, upload.array('images', 10), parseMultipart,
  (req, res, next) => validate(req.files?.length ? schemas.updateCombo.min(0) : schemas.updateCombo)(req, res, next), controller.updateCombo);
router.patch('/combos/:id/stock', id, validate(schemas.stock), controller.boxStock);
router.delete('/combos/:id', id, controller.deleteBox);
router.get('/gifts', (req, res, next) => { req.managerKind = 'gift'; next(); }, controller.combos);
router.post('/gifts', validate(schemas.createGift), controller.createGift);
router.patch('/gifts/:id', id, validate(schemas.updateGift), controller.updateGift);
router.get('/subscriptions', controller.subscriptions);
router.post('/subscriptions', validate(schemas.createSubscription), controller.createSubscription);
router.post('/retail-subscriptions', validate(schemas.createRetail), controller.createRetail);
router.patch('/retail-subscriptions/:id/stock', id, validate(schemas.stock), controller.retailStock);
router.patch('/subscriptions/:id', id, validate(schemas.updateSubscription), controller.updateSubscription);
router.delete('/subscriptions/:id', id, controller.deleteSubscription);
router.get('/orders', controller.orders);
router.get('/orders/:id', id, controller.orderDetail);
router.patch('/orders/:id/status', id, validate(schemas.orderStatus), controller.orderStatus);
router.post('/orders/:id/status', id, validate(schemas.orderStatus), controller.orderStatus);
module.exports = router;
