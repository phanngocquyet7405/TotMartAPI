const Joi = require('joi');
const id = Joi.string().hex().length(24).required();
const reason = Joi.string().trim().min(10).max(500).required();
const safeAmount = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required();
module.exports = {
  allocateSchema: Joi.object({ paymentCode: Joi.string().pattern(/^TMART[A-Z0-9]{1,100}$/).required(),
    eventIds: Joi.array().items(id).min(1).max(50).unique().required(), reason,
    allowUnmatched: Joi.boolean().default(false) }).unknown(false),
  refundReceiptSchema: Joi.object({ eventId: id, reason }).unknown(false),
  completeSchema: Joi.object({ amount: safeAmount,
    reference: Joi.string().trim().min(3).max(150).required(), evidence: reason }).unknown(false),
  idSchema: Joi.object({ _id: id }).unknown(false),
};
