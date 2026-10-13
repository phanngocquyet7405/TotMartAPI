const redis = require('../config/redis');
const Notification = require("../models/Notification");
const { randomUUID } = require("crypto");
const {
  registerSseClient,
  removeSseClient,
  issueSseTicket,
  consumeSseTicket,
  revokeUserSseTickets,
} = require("../utils/notify");

// Each user may have several open tabs.
const activeUserStreams = new Map();

function terminateUserStreams(userId) {
  const key = String(userId);

  // Prevent previously issued tickets from reopening a revoked stream.
  revokeUserSseTickets(key);

  const streams = activeUserStreams.get(key);
  if (!streams) return;

  // Closing a stream removes it from the original Set.
  for (const close of [...streams]) close();
}

class NotificationController {
  issueStreamTicket(req, res, next) {
    try {
      const ticket = issueSseTicket(req.userId, { tokenVersion:req.user.tokenVersion ?? 0, sid:req.user.sid });
      if (ticket?.then) return ticket.then(value => res.json({success:true,data:{ticket:value}})).catch(next);
      res.json({ success:true, data:{ticket} });
    } catch(err) { next(err); }
  }

  streamNotifications(req, res, next) {
    if (redis.enabled() && !req._verifiedStreamTicket) {
      return Promise.resolve(consumeSseTicket(req.query.ticket)).then(async credentials => {
        if (!credentials || !await validCredentials(credentials)) return res.status(401).json({success:false,message:'Invalid or revoked stream ticket'});
        return module.exports.streamNotifications({ ...req, _verifiedStreamTicket:credentials },res,next);
      }).catch(next);
    }
    const credentials = req._verifiedStreamTicket;
    const userId = credentials?.userId || consumeSseTicket(req.query.ticket);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired ticket",
      });
    }

    if ((activeUserStreams.get(String(userId))?.size || 0) >= 5) return res.status(429).json({success:false,message:'Too many open streams'});
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    const key = String(userId);
    const clientId = randomUUID();
    let closed = false;
    let heartbeat;

    const cleanup = () => {
      if (closed) return;
      closed = true;

      clearInterval(heartbeat);
      removeSseClient(clientId);

      const streams = activeUserStreams.get(key);
      streams?.delete(close);

      if (streams?.size === 0) {
        activeUserStreams.delete(key);
      }
    };

    const close = () => {
      cleanup();

      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {
          res.destroy();
        }
      }
    };

    if (!activeUserStreams.has(key)) {
      activeUserStreams.set(key, new Set());
    }

    activeUserStreams.get(key).add(close);
    registerSseClient(clientId, res);

    let checking = false;
    heartbeat = setInterval(async () => {
      if (checking || closed) return;
      checking = true;
      try {
        if (credentials && (!redis.ready() || !await validCredentials(credentials))) { close(); return; }
        res.write(": ping\n\n");
      } catch {
        close();
      } finally { checking = false; }
    }, 20000);

    // Observe response closure, not completion of the incoming request.
    res.once("close", cleanup);
    res.once("error", close);
  }

  async getNotifications(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));
      const filter = {};
      if (req.query.isRead !== undefined) {
        filter.isRead = req.query.isRead === "true";
      }

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Notification.countDocuments(filter),
        Notification.countDocuments({ isRead: false }),
      ]);

      res.status(200).json({
        success: true,
        data: notifications,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        unreadCount,
      });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const notification = await Notification.findByIdAndUpdate(
        req.params._id,
        { isRead: true, readAt: new Date(), readBy: req.userId },
        { new: true },
      );
      if (!notification) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy thông báo" });
      }
      res.status(200).json({ success: true, data: notification });
    } catch (error) {
      next(error);
    }
  }

  async markAllAsRead(req, res, next) {
    try {
      await Notification.updateMany(
        { isRead: false },
        { isRead: true, readAt: new Date(), readBy: req.userId },
      );
      res
        .status(200)
        .json({ success: true, message: "Đã đánh dấu tất cả đã đọc" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
module.exports.terminateUserStreams = terminateUserStreams;

async function validCredentials(credentials) {
  const user = await require('../models/User').findById(credentials.userId);
  if (!user || user.isActive === false || user.role !== 'admin' || user.tokenVersion !== credentials.tokenVersion) return false;
  if (!credentials.sid) return process.env.NODE_ENV !== 'production';
  return Boolean(await require('../models/AuthSession').exists({sessionId:credentials.sid,userId:user._id,tokenVersion:user.tokenVersion,expiresAt:{$gt:new Date()}}));
}
module.exports.terminateAllStreams = () => { for (const userId of [...activeUserStreams.keys()]) terminateUserStreams(userId); };
