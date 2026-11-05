const crypto = require('crypto');
const Order = require('../models/Order');

/**
 * Creates Orders from orderGroups in stable order within the provided session.
 * Used by both COD checkout and Online payment reconciliation (settle).
 *
 * @param {Array} groups - Order groups from quote or checkout snapshot
 * @param {Object} options - Common order attributes
 * @param {ObjectId|string} options.userId - Customer user ID
 * @param {string} [options.paymentCode] - Checkout payment code
 * @param {string} [options.paymentMethod='cod'] - 'cod' or 'online'
 * @param {string} [options.status='pending'] - Initial order status
 * @param {string} [options.paymentStatus='pending'] - Initial payment status
 * @param {boolean} [options.stockDeducted=false] - Whether stock was already deducted
 * @param {ClientSession} session - MongoDB transactional session
 * @returns {Promise<Array<Order>>} Created order documents
 */
async function createOrdersFromGroups(
  groups,
  {
    userId,
    paymentCode,
    paymentMethod = 'cod',
    status = 'pending',
    paymentStatus = 'pending',
    stockDeducted = false,
  },
  session,
) {
  const created = [];
  for (const group of groups) {
    const [order] = await Order.create(
      [
        {
          userId,
          merchantId: group.merchantId,
          paymentCode: paymentCode || group.paymentCode,
          customerEmail: group.customerEmail,
          products: group.products,
          boxes: group.boxes,
          orderId: 'ORD' + crypto.randomBytes(12).toString('hex').toUpperCase(),
          totalAmount: group.totalAmount,
          giftFee: group.giftFee,
          bulkDiscountAmount: group.bulkDiscountAmount,
          pricingPolicyVersion: group.pricingPolicyVersion,
          shippingFee: group.shippingFee,
          shippingPayment: group.shippingPayment,
          shippingMode: group.shippingMode,
          discountAmount: group.discountAmount,
          couponCode: group.couponCode,
          shippingAddress: group.shippingAddress,
          paymentMethod,
          note: group.note,
          status,
          paymentStatus,
          stockDeducted,
        },
      ],
      { session },
    );
    created.push(order);
  }
  return created;
}

module.exports = { createOrdersFromGroups };
