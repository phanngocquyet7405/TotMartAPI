const Product = require('../models/Product');
const Box = require('../models/Box');
const { fail } = require('./pricingService');
async function deductStock(products, session, boxes = []) {
  for (const item of products) {
    const updated = await Product.findOneAndUpdate({ _id: item.productId, instock: true, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { session, new: true });
    if (!updated) fail(`Sản phẩm "${item.name}" vừa hết hàng`, 409);
    if (updated.stock === 0) await Product.findByIdAndUpdate(updated._id, { instock: false }, { session });
  }
  for (const item of boxes) {
    const updated = await Box.findOneAndUpdate({ _id: item.boxId, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { session });
    if (!updated) fail(`Hộp "${item.name}" vừa hết hàng`, 409);
  }
}
async function restoreStock(products, session, boxes = []) {
  for (const item of products) await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity }, instock: true }, { session });
  for (const item of boxes) await Box.findByIdAndUpdate(item.boxId, { $inc: { stock: item.quantity } }, { session });
}
// Webhook can accept payment even when stock is short. Undo every partial reservation.
async function reserveOrder(order, session) {
  const products = [], boxes = [];
  try {
    for (const item of order.products) { await deductStock([item], session); products.push(item); }
    for (const item of order.boxes || []) { await deductStock([], session, [item]); boxes.push(item); }
    order.stockDeducted = true; order.status = 'processing';
  } catch (error) {
    if (error.statusCode !== 409) throw error;
    await restoreStock(products, session, boxes);
    order.stockDeducted = false; order.status = 'on_hold';
    order._statusChangeNote = 'Đã nhận tiền; cần bổ sung hàng hoặc hoàn tiền';
  }
}
module.exports = { deductStock, restoreStock, reserveOrder };
