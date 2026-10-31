const crypto = require('crypto');
const Checkout = require('../models/Checkout');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const { fail } = require('./pricingService');
const { AUTH_READ_TIMEOUT_MS } = require('../config/authReadPolicy');
function requestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
function paymentCode() {
  return 'TMART' + Date.now() + crypto.randomBytes(6).toString('hex').toUpperCase();
}
async function lockCheckout(codeOrFilter, session) {
  // Every writer touches this common document inside the same transaction.
  // Payment, cancellation and expiry therefore cannot commit conflicting snapshots.
  const filter = typeof codeOrFilter === 'string' ? { paymentCode: codeOrFilter } : codeOrFilter;
  return Checkout.findOneAndUpdate(filter, { $inc: { revision: 1 } }, { session, new: true });
}
async function replay(userId, key, hash, session = null, kind = null) {
  const query = Checkout.findOne({ userId, requestKey: key }).session(session);
  if (!session) query.setOptions({ timeoutMS: AUTH_READ_TIMEOUT_MS });
  const checkout = await query;
  if (checkout && kind && (checkout.kind || 'products') !== kind)
    fail('IDEMPOTENCY_KIND_CONFLICT', 409);
  if (checkout && checkout.requestHash !== hash)
    fail('Idempotency-Key đã được dùng với nội dung khác', 409);
  return checkout;
}
async function releaseCoupon(checkout, session, finalState = 'cancelled') {
  if (!checkout?.couponCode || checkout.couponReleased) return;
  const remaining = await Order.exists({
    paymentCode: checkout.paymentCode,
    status: { $ne: 'cancelled' },
  }).session(session);
  if (remaining) return;
  await Coupon.updateOne(
    { code: checkout.couponCode, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
    { session },
  );
  checkout.couponReleased = true;
  checkout.state = finalState;
  await checkout.save({ session });
}
function qrUrl(code, amount) {
  if (
    !require('../config/environment').sepay.bankAccount ||
    !require('../config/environment').sepay.bankName
  )
    fail('Chưa cấu hình tài khoản thanh toán', 503);
  const params = new URLSearchParams({
    acc: require('../config/environment').sepay.bankAccount,
    bank: require('../config/environment').sepay.bankName,
    amount: String(amount),
    des: code,
  });
  return `https://qr.sepay.vn/img?${params}`;
}
module.exports = { requestHash, paymentCode, lockCheckout, replay, releaseCoupon, qrUrl };
