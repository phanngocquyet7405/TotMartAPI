const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  providerEventId: String, accountNumber: String,
  paymentLedgerVersion: { type: Number, enum: [1, 2], default: 2 },
  disposition: { type: String, enum: ['unallocated', 'applied', 'refund_pending', 'refunded', 'legacy_review', 'legacy_processed'], default: 'unallocated' },
  nextAttempt: { type: Date, default: Date.now },
  referenceCode: { type: String, required: true, unique: true },
  paymentCode: String, transferAmount: Number,
  state: { type: String, enum: ['received', 'processed', 'unmatched', 'underpaid', 'not_payable', 'retry_required', 'legacy_review'], default: 'received' },
  payloadHash: { type: String, required: true }, receivedAt: { type: Date, default: Date.now }, processedAt: Date,
  attempts: { type: Number, default: 0 }, errorCode: String,
}, { timestamps: true });
schema.index({ state: 1, createdAt: -1 });
schema.index({ accountNumber: 1, providerEventId: 1 }, { unique: true, partialFilterExpression: { providerEventId: { $type: 'string' }, accountNumber: { $type: 'string' } } });
schema.index({ disposition: 1, state: 1, nextAttempt: 1 });
module.exports = mongoose.model('PaymentEvent', schema);
