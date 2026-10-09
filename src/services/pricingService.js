const crypto = require('crypto');
const Product = require('../models/Product');
const Box = require('../models/Box');
const Coupon = require('../models/Coupon');

function fail(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function unitPrice(product) { return Math.round(product.price * (1 - (product.salePercent || 0) / 100)); }
// Integer allocation preserves the exact total, including one-VND discounts.
function allocate(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) fail('Số tiền phân bổ không hợp lệ');
  if (!weights.length) return [];
  const normalized = weights.some(w => w > 0) ? weights : weights.map(() => 1);
  const sum = normalized.reduce((a, b) => a + BigInt(b), 0n), amount = BigInt(total);
  const values = normalized.map(w => Number(amount * BigInt(w) / sum));
  const rank = normalized.map((w, i) => ({ i, remainder: amount * BigInt(w) % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (let n = total - values.reduce((a, b) => a + b, 0), i = 0; i < n; i++) values[rank[i].i]++;
  return values;
}
async function couponDiscount(code, subtotal, session, claim = false) {
  if (!code) return { discountAmount: 0 };
  let coupon = await Coupon.findOne({ code }).session(session || null);
  const now = new Date();
  if (!coupon || !coupon.isActive || now < coupon.startDate || now > coupon.expiresAt) fail('Mã giảm giá không hợp lệ hoặc đã hết hạn');
  if (subtotal < coupon.minOrderValue) fail(`Đơn hàng cần tối thiểu ${coupon.minOrderValue} để dùng mã này`);
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) fail('Mã giảm giá đã hết lượt sử dụng', 409);
  if (claim) {
    coupon = await Coupon.findOneAndUpdate({ _id: coupon._id, isActive: true,
      startDate: { $lte: now }, expiresAt: { $gte: now },
      $expr: { $or: [{ $eq: ['$usageLimit', null] }, { $lt: ['$usedCount', '$usageLimit'] }] } },
    { $inc: { usedCount: 1 } }, { session, new: true });
    if (!coupon) fail('Mã giảm giá đã hết lượt sử dụng', 409);
  }
  const amount = coupon.discountType === 'percentage' ? Math.round(subtotal * coupon.discount / 100) : coupon.discount;
  return { discountAmount: Math.min(subtotal, Math.round(amount)), couponCode: coupon.code };
}
async function buildQuote(items, couponCode, session = null, claim = false) {
  if (!items?.length) fail('Giỏ hàng trống');
  const products = [], boxes = [], lines = [];
  async function productFor(id) {
    const product = await Product.findById(id).populate('brand').session(session);
    if (!product?.brand?.ownerId) fail('Sản phẩm không tồn tại hoặc không có người bán hợp lệ');
    return product;
  }
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail('Số lượng không hợp lệ');
    if (item.boxId) {
      const box = await Box.findById(item.boxId).session(session);
      const now = new Date();
      if (!box || box.validFrom > now || box.validTo < now || box.stock < item.quantity || box.isGift) fail('Hộp không còn bán hoặc không đủ hàng');
      const parts = [];
      for (const component of box.products) parts.push({ product: await productFor(component.productId), quantity: component.quantity * item.quantity });
      if (!parts.length) fail('Hộp không có sản phẩm hợp lệ');
      const value = Math.round(box.value) * item.quantity;
      const amounts = allocate(value, parts.map(p => unitPrice(p.product) * p.quantity));
      parts.forEach((part, i) => products.push({ productId: part.product._id, name: `${part.product.name} (${box.name})`,
        unitPrice: amounts[i] / part.quantity, quantity: part.quantity, totalPrice: amounts[i],
        brand: part.product.brand._id, merchantId: part.product.brand.ownerId, boxId: box._id }));
      boxes.push({ boxId: box._id, name: box.name, quantity: item.quantity });
      lines.push({ itemType: 'box', itemId: String(box._id), name: box.name, quantity: item.quantity, unitPrice: Math.round(box.value), totalPrice: value });
    } else {
      const product = await productFor(item.productId);
      const price = unitPrice(product);
      products.push({ productId: product._id, name: product.name, unitPrice: price, quantity: item.quantity,
        totalPrice: price * item.quantity, brand: product.brand._id, merchantId: product.brand.ownerId });
      lines.push({ itemType: 'product', itemId: String(product._id), name: product.name, quantity: item.quantity, unitPrice: price, totalPrice: price * item.quantity });
    }
  }
  const demand = new Map();
  for (const p of products) demand.set(String(p.productId), (demand.get(String(p.productId)) || 0) + p.quantity);
  for (const [id, quantity] of demand) { const p = await Product.findById(id).session(session); if (!p || p.instock === false || p.stock < quantity) fail('Một sản phẩm trong giỏ không đủ hàng'); }
  const subtotal = products.reduce((sum, p) => sum + p.totalPrice, 0);
  const discount = await couponDiscount(couponCode, subtotal, session, claim);
  const shippingFee = subtotal > 0 && subtotal < 500000 ? 30000 : 0;
  const totalAmount = subtotal - discount.discountAmount + shippingFee;
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) fail('Số tiền VND không hợp lệ');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ lines, couponCode: discount.couponCode, subtotal, shippingFee, discountAmount: discount.discountAmount, totalAmount })).digest('hex');
  return { products, boxes, lines, subtotal, shippingFee, ...discount, totalAmount, fingerprint };
}
module.exports = { unitPrice, allocate, couponDiscount, buildQuote, fail };
