const Joi = require('joi');
const id = Joi.string().hex().length(24);
const integer = Joi.number().integer().max(Number.MAX_SAFE_INTEGER);
const name = Joi.string().trim().min(3).max(100);
const parts = Joi.array().items(Joi.object({ productId: id.required(), quantity: integer.min(1).max(999).required() })).min(1).max(100).unique('productId');
const giftPolicy = Joi.object({
  bulkTiers: Joi.array().items(Joi.object({ minQuantity: integer.min(2).max(999).required(), percent: Joi.number().min(0).max(100).required() })).max(10).unique('minQuantity').default([]),
  amenities: Joi.array().items(Joi.object({ name: Joi.string().trim().min(1).max(100).required(), fee: integer.min(0).max(100000000).required() })).max(10).default([]),
});
const productFields = { name, description: Joi.string().trim().min(1).max(500), price: integer.positive(), brand: id, category: id };
const comboFields = { name, descriptions: Joi.string().trim().min(1).max(5000), products: parts, discountPercent: Joi.number().min(0).max(100), validTo: Joi.date().greater('now') };
const subscriptionFields = { name: Joi.string().trim().min(2).max(100), description: Joi.string().max(500).allow(''), planType: Joi.string().valid('1_month', '3_month', '6_month', '12_month'), discountPercent: Joi.number().min(0).less(100), isActive: Joi.boolean() };
const requireFields = (fields, required) => Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, required.includes(key) ? schema.required() : schema]));
module.exports = {
  idParams: Joi.object({ id: id.required() }),
  createProduct: Joi.object({ ...requireFields(productFields, Object.keys(productFields)), stock: integer.min(0).required() }),
  updateProduct: Joi.object(productFields).min(1),
  createCombo: Joi.object({ ...requireFields(comboFields, ['name', 'descriptions', 'products', 'validTo']), stock: integer.min(0).required(), discountPercent: comboFields.discountPercent.default(0) }),
  updateCombo: Joi.object(comboFields).min(1),
  createGift: Joi.object({ name: name.required(), comboId: id.required(), stock: integer.min(0).required(), validTo: Joi.date().greater('now').required(), giftPolicy: giftPolicy.default({ bulkTiers: [], amenities: [] }) }),
  updateGift: Joi.object({ name, validTo: Joi.date().greater('now'), giftPolicy }).min(1),
  createSubscription: Joi.object({ ...requireFields(subscriptionFields, ['name', 'planType']), boxId: id.required(), discountPercent: subscriptionFields.discountPercent.default(0), isActive: Joi.boolean().default(true) }),
  createRetail: Joi.object({ ...requireFields(subscriptionFields, ['name', 'planType']), products: parts.required(), stock: integer.min(0).required(), validTo: Joi.date().greater('now').required(), discountPercent: subscriptionFields.discountPercent.default(0), isActive: Joi.boolean().default(true) }),
  updateSubscription: Joi.object({ ...subscriptionFields, boxId: id }).min(1),
  stock: Joi.object({ delta: integer.min(-1000000).max(1000000).invalid(0).required(), reason: Joi.string().trim().max(200).allow('') }),
  orderStatus: Joi.object({ status: Joi.string().valid('processing', 'shipped', 'delivered').required(), expectedStatus: Joi.string().valid('pending', 'processing', 'shipped', 'delivered'), trackingReference: Joi.string().trim().min(3).max(150), note: Joi.string().trim().max(500).allow('') }),
  giftPolicy,
};
