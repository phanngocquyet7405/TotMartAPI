const crypto = require("crypto");
const Notification = require("../models/Notification");

const sseClients = new Map();

function registerSseClient(clientId, res) {
  sseClients.set(clientId, res);
}

function removeSseClient(clientId) {
  sseClients.delete(clientId);
}

function broadcastToAdmins(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [clientId, res] of sseClients.entries()) {
    try {
      res.write(data);
    } catch (err) {
      sseClients.delete(clientId);
    }
  }
}

// Vé dùng 1 lần, sống 30s — cho phép SSE hoạt động đúng bất kể FE/BE cùng domain hay khác domain
// (xem giải thích ở trên).
const ssePendingTickets = new Map();

function issueSseTicket(userId) {
  const ticket = crypto.randomUUID();
  ssePendingTickets.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
  return ticket;
}

function consumeSseTicket(ticket) {
  const entry = ssePendingTickets.get(ticket);
  if (!entry) return null;
  ssePendingTickets.delete(ticket); // dùng 1 lần, dùng xong xoá ngay
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

const NOTIFICATION_MESSAGES = {
  new_order: (order) =>
    `Đơn hàng mới ${order.orderId} - ${order.totalAmount.toLocaleString("vi-VN")}đ (COD)`,
  payment_received: (order) =>
    `Đã nhận thanh toán đơn ${order.orderId} - ${order.totalAmount.toLocaleString("vi-VN")}đ`,
  order_cancelled: (order) => `Đơn hàng ${order.orderId} đã bị huỷ`,
  payment_underpaid: (order) =>
    `Đơn ${order.orderId} nhận thiếu tiền — cần đối soát thủ công`,
};

async function notifyMerchant(order, type) {
  const buildMessage = NOTIFICATION_MESSAGES[type];
  if (!buildMessage) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  const notification = await Notification.create({
    type,
    order: order._id,
    orderCode: order.orderId,
    message: buildMessage(order),
    meta: {
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      customerName: order.shippingAddress?.fullName,
    },
  });

  broadcastToAdmins({
    _id: notification._id,
    type: notification.type,
    orderCode: notification.orderCode,
    message: notification.message,
    meta: notification.meta,
    createdAt: notification.createdAt,
  });

  return notification;
}

module.exports = {
  notifyMerchant,
  registerSseClient,
  removeSseClient,
  issueSseTicket,
  consumeSseTicket,
};
