const { randomUUID } = require('crypto');
module.exports = function idempotencyKey(
  req,
  production = require('../config/environment').nodeEnv === 'production',
) {
  const key = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
  if ((production && !key) || (key && !/^[A-Za-z0-9_-]{16,128}$/.test(key))) {
    throw Object.assign(
      new Error('Idempotency-Key 16–128 ký tự là bắt buộc cho giao dịch production'),
      { statusCode: 400 },
    );
  }
  return key || randomUUID();
};
