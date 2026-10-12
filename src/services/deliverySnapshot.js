const Joi = require('joi');

const deliverySchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().pattern(/^(?:0\d{9}|\+[1-9]\d{7,14})$/).required(),
  address: Joi.string().trim().min(5).max(300).required(),
  district: Joi.string().trim().min(1).max(120).required(),
  city: Joi.string().trim().min(1).max(120).required(),
  country: Joi.string().trim().min(2).max(100).required(),
}).unknown(false);

function deliverySnapshot(user, address) {
  const candidate = {
    fullName: user?.name,
    phone: address?.phone,
    address: address?.address,
    district: address?.district,
    city: address?.city,
    country: address?.country,
  };
  const { error, value } = deliverySchema.validate(candidate, {
    abortEarly: false, convert: true, stripUnknown: false,
  });
  if (error) {
    const err = new Error('Thông tin giao hàng chưa đầy đủ hoặc không hợp lệ. Vui lòng cập nhật địa chỉ.');
    err.status = 422;
    // Field names only: never include phone/address values in logs.
    err.code = 'INVALID_DELIVERY_ADDRESS';
    err.fields = [...new Set(error.details.map(detail => detail.path.join('.')))];
    throw err;
  }
  return Object.freeze(value);
}

module.exports = { deliverySchema, deliverySnapshot };
