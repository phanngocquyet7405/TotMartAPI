// Fulfillment authority never implies authority over bank receipts, refunds or COD settlement.
function allowedTransitions(order) {
  if (!order.stockDeducted || order.refundStatus === 'pending' || order.paymentStatus === 'failed') return [];
  if (order.paymentMethod === 'online' && order.paymentStatus !== 'paid') return [];
  if (order.status === 'pending' && order.paymentMethod === 'cod' && order.paymentStatus === 'pending') return ['processing'];
  if (order.status === 'processing') return ['shipped'];
  if (order.status === 'shipped') return ['delivered'];
  return [];
}
function transition(order, input, actorId) {
  // Lost-response retry of the same target is a no-op, not a second financial action.
  if (order.status === input.status && ['processing', 'shipped', 'delivered'].includes(input.status)) return false;
  if (input.expectedStatus && input.expectedStatus !== order.status) throw Object.assign(new Error('Đơn đã thay đổi; tải lại trước khi thao tác'), { statusCode: 409 });
  if (!allowedTransitions(order).includes(input.status)) throw Object.assign(new Error('Đơn chưa đủ điều kiện hoặc không được chuyển trạng thái này'), { statusCode: 409 });
  if (input.trackingReference) order.trackingReference = input.trackingReference;
  order.status = input.status;
  order._statusChangedBy = actorId;
  order._statusChangeNote = input.note || 'Merchant cập nhật tiến độ giao hàng';
  if (input.status === 'delivered') {
    order.deliveryConfirmedBy = actorId;
    if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
      order.codCollectionStatus = 'pending_review';
      order._statusChangeNote += '; COD chờ admin đối soát, chưa xác nhận thanh toán';
    }
  }
  return true;
}
module.exports = { allowedTransitions, transition };
