const redis = require('../config/redis');
const crypto = require("crypto");
const Notification = require("../models/Notification");

const sseClients = new Map();

function registerSseClient(clientId, res) {
  sseClients.set(clientId, res);
}

function removeSseClient(clientId) {
  sseClients.delete(clientId);
}

function broadcastLocal(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [clientId, res] of sseClients.entries()) {
    try {
      res.write(data);
    } catch (err) {
      sseClients.delete(clientId);
    }
  }
}

const ssePendingTickets = new Map();

function issueSseTicket(userId, credentials = {}) {
  const ticket = crypto.randomUUID();
  if (redis.enabled()) {
    return redis.getClient().set(redis.namespace() + ':ticket:' + ticket, JSON.stringify({userId:String(userId),...credentials}), {EX:30,NX:true}).then(() => ticket);
  }
  for (const [key, entry] of ssePendingTickets) if (entry.expiresAt <= Date.now()) ssePendingTickets.delete(key);
  if (ssePendingTickets.size >= 10000) throw Object.assign(new Error('Too many stream tickets'), {statusCode:429});
  ssePendingTickets.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
  return ticket;
}

function consumeSseTicket(ticket) {
  if (typeof ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket)) return null;
  if (redis.enabled()) return redis.getClient().getDel(redis.namespace() + ':ticket:' + ticket).then(value => value ? JSON.parse(value) : null);
  const entry = ssePendingTickets.get(ticket);

  if (!entry) return null;

  ssePendingTickets.delete(ticket);

  if (entry.expiresAt <= Date.now()) return null;

  return entry.userId;
}

function revokeUserSseTickets(userId) {
  const key = String(userId);

  for (const [ticket, entry] of ssePendingTickets) {
    if (String(entry.userId) === key) {
      ssePendingTickets.delete(ticket);
    }
  }
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

async function notifyMerchant(order, type, eventKey) {
  const buildMessage = NOTIFICATION_MESSAGES[type];
  if (!buildMessage) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  const payload = {
    type,
    order: order._id,
    orderCode: order.orderId,
    message: buildMessage(order),
    meta: {
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      customerName: order.shippingAddress?.fullName,
    },
  };
  const notification = eventKey
    ? await Notification.findOneAndUpdate({ eventKey }, { $setOnInsert: { ...payload, eventKey } }, { upsert: true, new: true })
    : await Notification.create(payload);

  const broadcast = {
    _id: notification._id,
    type: notification.type,
    orderCode: notification.orderCode,
    message: notification.message,
    meta: notification.meta,
    createdAt: notification.createdAt,
  };
  if (redis.enabled()) await redis.getClient().publish(redis.namespace() + ':notifications', JSON.stringify(broadcast));
  else broadcastLocal(broadcast);

  return notification;
}

module.exports = {
  broadcastLocal,
  notifyMerchant,
  registerSseClient,
  removeSseClient,
  issueSseTicket,
  consumeSseTicket,
  revokeUserSseTickets,
};
