const crypto = require('crypto');
const Checkout = require('../models/Checkout');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const { fail } = require('./pricingService');
function requestHash(body) { return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
function paymentCode() { return 'TMART' + Date.now() + crypto.randomBytes(6).toString('hex').toUpperCase(); }
async function lockCheckout(code, session) {
  // Every writer touches this common document inside the same transaction.
  // Payment, cancellation and expiry therefore cannot commit conflicting snapshots.
  return Checkout.findOneAndUpdate({ paymentCode: code }, { $inc: { revision: 1 } }, { session, new: true });
}
async function replay(userId, key, hash, session = null) {
  const checkout = await Checkout.findOne({ userId, requestKey: key }).session(session);
  if (checkout && checkout.requestHash !== hash) fail('Idempotency-Key đã được dùng với nội dung khác', 409);
  return checkout;
}
async function releaseCoupon(checkout, session) {
  if (!checkout?.couponCode || checkout.couponReleased) return;
  const remaining = await Order.exists({ paymentCode: checkout.paymentCode, status: { $ne: 'cancelled' } }).session(session);
  if (remaining) return;
  await Coupon.updateOne({ code: checkout.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
  checkout.couponReleased = true; checkout.state = 'cancelled';
  await checkout.save({ session });
}
function qrUrl(code, amount) {
  if (!process.env.SEPAY_BANK_ACCOUNT || !process.env.SEPAY_BANK_NAME) fail('Chưa cấu hình tài khoản thanh toán', 503);
  const params = new URLSearchParams({ acc: process.env.SEPAY_BANK_ACCOUNT, bank: process.env.SEPAY_BANK_NAME, amount: String(amount), des: code });
  return `https://qr.sepay.vn/img?${params}`;
}
module.exports = { requestHash, paymentCode, lockCheckout, replay, releaseCoupon, qrUrl };
