const { randomUUID } = require('crypto');
const Outbox = require('../models/SecurityOutbox');
const redis = require('../config/redis');
const logger = require('../utils/logger');
async function drain(limit = 50) {
  if (!redis.enabled()) return; // Local development has one process; durable records remain available for inspection.
  for (let i = 0; i < limit; i++) {
    const leaseId = randomUUID(), now = new Date();
    const event = await Outbox.findOneAndUpdate({ state: 'pending', nextAttempt: { $lte: now }, leaseUntil: { $lte: now } },
      { $set: { leaseId, leaseUntil: new Date(now.getTime() + 30000) }, $inc: { attempts: 1 } }, { new: true });
    if (!event) return;
    try {
      await redis.getClient().publish(redis.namespace() + ':security', JSON.stringify({ eventId: String(event._id), userId: String(event.userId), tokenVersion: event.tokenVersion, sessionId: event.sessionId }));
      await Outbox.updateOne({ _id: event._id, leaseId }, { $set: { state: 'published', publishedAt: new Date() } });
    } catch (err) {
      await Outbox.updateOne({ _id: event._id, leaseId }, { $set: { leaseUntil: new Date(0), nextAttempt: new Date(Date.now() + 5000) } });
      logger.warn({ eventId: String(event._id) }, 'Security revocation delivery will retry');
    }
  }
}
function start() { let busy = false; const run = async () => { if (busy) return; busy = true; try { await drain(); } catch { logger.error('Security outbox worker failed'); } finally { busy = false; } }; const timer = setInterval(run, 1000); timer.unref(); void run(); return timer; }
module.exports = { drain, start };
