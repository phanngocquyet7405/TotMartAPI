const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  referenceCode: { type: String, required: true, unique: true },
  paymentCode: String, transferAmount: Number,
  state: { type: String, enum: ['received', 'processed', 'unmatched', 'underpaid', 'not_payable', 'retry_required'], default: 'received' },
  payloadHash: { type: String, required: true }, receivedAt: { type: Date, default: Date.now }, processedAt: Date,
  attempts: { type: Number, default: 0 }, errorCode: String,
}, { timestamps: true });
schema.index({ state: 1, createdAt: -1 });
module.exports = mongoose.model('PaymentEvent', schema);
