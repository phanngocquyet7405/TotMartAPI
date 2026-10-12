const Event = require('../models/PaymentEvent');
const { processReceipt } = require('../services/paymentReconciliationService');
const logger = require('../utils/logger');
async function drain() {
  const due = await Event.find({ paymentLedgerVersion: 2, disposition: 'unallocated',
    state: { $in: ['received', 'retry_required'] }, nextAttempt: { $lte: new Date() } })
    .sort({ nextAttempt: 1, _id: 1 }).limit(50).select('_id');
  for (const event of due) {
    try { await processReceipt(event._id); }
    catch (err) {
      await Event.updateOne({ _id: event._id, disposition: 'unallocated' }, { $inc: { attempts: 1 },
        $set: { state: 'retry_required', errorCode: String(err.statusCode || 503),
          nextAttempt: new Date(Date.now() + 60000) } });
      logger.error({ err, eventId: String(event._id) }, 'Reconciliation deferred');
    }
  }
}
function start() {
  let running = false;
  const run = async () => { if (running) return; running = true;
    try { await drain(); } catch (err) { logger.error({ err }, 'Reconciliation worker failed'); }
    finally { running = false; } };
  const timer = setInterval(run, 10000); timer.unref(); void run(); return timer;
}
module.exports = { drain, start };
