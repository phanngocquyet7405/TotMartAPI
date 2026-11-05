const Joi = require('joi');
const schema = Joi.object({
  bulkTiers: Joi.array().items(Joi.object({ minQuantity: Joi.number().integer().min(2).max(999).required(), percent: Joi.number().min(0).max(100).required() })).max(10).unique('minQuantity').default([]),
  amenities: Joi.array().items(Joi.object({ name: Joi.string().trim().min(1).max(100).required(), fee: Joi.number().integer().min(0).max(100000000).required() })).max(10).default([]),
});
function quoteGift(box, quantity) {
  const { value: policy, error } = schema.validate(box.giftPolicy?.toObject ? box.giftPolicy.toObject() : box.giftPolicy || {}, { stripUnknown: true });
  if (error) throw Object.assign(new Error('Chính sách gift không hợp lệ'), { statusCode: 400 });
  const percent = policy.bulkTiers.filter(t => quantity >= t.minQuantity).sort((a, b) => b.minQuantity - a.minQuantity)[0]?.percent || 0;
  const base = Math.round(box.value) * quantity;
  return { base, percent, discount: Math.round(base * percent / 100), amenityFee: policy.amenities.reduce((sum, a) => sum + a.fee, 0) * quantity };
}
module.exports = { schema, quoteGift };
