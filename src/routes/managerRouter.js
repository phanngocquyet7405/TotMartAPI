const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/authMiddleware');
const schemas = require('../middleware/managerSchemas');
const upload = require('../middleware/uploadMiddleware');
const catalog = require('../services/managerCatalogService');
const product = require('../controllers/productController');
const controller = require('../controllers/managerController');
const router = express.Router();
router.use(auth.authenticate, (req, res, next) => {
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
router.get('/catalog-options', auth.requireMerchant, controller.options);
router.post('/brands', auth.requireMerchant, validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() })), controller.createBrand);
router.get('/products', auth.requireMerchant, controller.products);
router.post('/products', auth.requireMerchant, upload.array('images', 10), validate(schemas.createProduct), ownReferences, product.createProduct);
router.put('/products/:id', id, auth.requireMerchant, ownProduct, upload.array('images', 10),
  (req, res, next) => validate(req.files?.length ? schemas.updateProduct.min(0) : schemas.updateProduct)(req, res, next), ownReferences, product.updateProduct);
router.patch('/products/:id/stock', id, auth.requireMerchant, validate(schemas.stock), controller.productStock);
router.delete('/products/:id', id, auth.requireMerchant, ownProduct, product.deleteProduct);
router.get('/combos', auth.requireMerchant, controller.combos);
router.post('/combos', auth.requireMerchant, upload.array('images', 10), parseMultipart, validate(schemas.createCombo), controller.createCombo);
router.put('/combos/:id', id, auth.requireMerchant, upload.array('images', 10), parseMultipart,
  (req, res, next) => validate(req.files?.length ? schemas.updateCombo.min(0) : schemas.updateCombo)(req, res, next), controller.updateCombo);
router.patch('/combos/:id/stock', id, auth.requireMerchant, validate(schemas.stock), controller.boxStock);
router.delete('/combos/:id', id, auth.requireMerchant, controller.deleteBox);
router.get('/gifts', auth.requireMerchant, (req, res, next) => { req.managerKind = 'gift'; next(); }, controller.combos);
router.post('/gifts', auth.requireMerchant, validate(schemas.createGift), controller.createGift);
router.patch('/gifts/:id', id, auth.requireMerchant, validate(schemas.updateGift), controller.updateGift);
router.get('/subscriptions', auth.requireMerchant, controller.subscriptions);
router.post('/subscriptions', auth.requireMerchant, validate(schemas.createSubscription), controller.createSubscription);
router.post('/retail-subscriptions', auth.requireMerchant, validate(schemas.createRetail), controller.createRetail);
router.patch('/retail-subscriptions/:id/stock', id, auth.requireMerchant, validate(schemas.stock), controller.retailStock);
router.patch('/subscriptions/:id', id, auth.requireMerchant, validate(schemas.updateSubscription), controller.updateSubscription);
router.delete('/subscriptions/:id', id, auth.requireMerchant, controller.deleteSubscription);
router.get('/orders', auth.requireMerchant, controller.orders);
router.get('/orders/:id', id, auth.requireMerchant, controller.orderDetail);
router.patch('/orders/:id/status', id, auth.requireMerchant, validate(schemas.orderStatus), controller.orderStatus);
router.post('/orders/:id/status', id, auth.requireMerchant, validate(schemas.orderStatus), controller.orderStatus);
module.exports = router;
