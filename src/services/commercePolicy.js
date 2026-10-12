const crypto = require('crypto');
const Joi = require('joi');
const giftSchema = Joi.object({
  wrap: Joi.string().valid('none', 'classic', 'eco', 'premium').default('none'),
  message: Joi.string().trim().max(500).allow('').default(''),
}).unknown(false);
const fees = Object.freeze({ none: 0, classic: 15000, eco: 15000, premium: 35000 });
function fail(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; throw e; }
function giftFor(value) {
  if (value?.toObject) value = value.toObject();
  const { value: gift, error } = giftSchema.validate(value == null ? {} : value, { convert: false });
  if (error) fail('Gift options không hợp lệ');
  return gift;
}
function identity(item) {
  const productId = item.productId?._id || item.productId;
  const boxId = item.boxId?._id || item.boxId;
  if (Boolean(productId) === Boolean(boxId)) fail('Cart line phải có đúng một productId hoặc boxId');
  return `${boxId ? 'box' : 'product'}:${String(boxId || productId)}`;
}
function lineId(item) {
  return crypto.createHash('sha256').update(JSON.stringify([identity(item), giftFor(item.gift)])).digest('hex');
}
function normalizeLines(items) {
  if (!Array.isArray(items) || items.length > 100) fail('Giỏ tối đa 100 dòng');
  const merged = new Map();
  for (const raw of items) {
    const item = raw?.toObject ? raw.toObject() : raw;
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail('Số lượng không hợp lệ');
    const gift = giftFor(item.gift), id = lineId({ ...item, gift });
    if (item.lineId && item.lineId !== id) fail('lineId không khớp cấu hình quà');
    const previous = merged.get(id), quantity = (previous?.quantity || 0) + item.quantity;
    if (quantity > 999) fail('Tổng số lượng một dòng vượt 999');
    merged.set(id, { ...(item.boxId ? { boxId: item.boxId?._id || item.boxId } : { productId: item.productId?._id || item.productId }), quantity, gift, lineId: id });
  }
  return [...merged.values()].sort((a,b) => a.lineId.localeCompare(b.lineId));
}
function bulkPercent(quantity) { return quantity >= 5 ? 10 : quantity >= 3 ? 5 : 0; }
function safeMoney(value) { if (!Number.isSafeInteger(value) || value < 0) fail('Số tiền VND không hợp lệ'); return value; }
function sum(values) {
  const amount = values.reduce((a,b) => a + BigInt(safeMoney(b)), 0n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('Tổng tiền vượt giới hạn');
  return Number(amount);
}
function policy() { return { version: 'commerce-v1', wrappingFees: fees, wrappingPer: 'unit', bulk: { appliesTo: 'standalone-product', tiers: [{ minQuantity: 3, percent: 5 }, { minQuantity: 5, percent: 10 }], aggregateBy: 'productId' }, couponBase: 'merchandise-after-bulk', shippingThresholdBase: 'merchandise-after-bulk-before-coupon', shippingThreshold: 500000, shippingFee: 30000 }; }
module.exports = { giftSchema, giftFor, lineId, normalizeLines, bulkPercent, fees, safeMoney, sum, policy, fail };
