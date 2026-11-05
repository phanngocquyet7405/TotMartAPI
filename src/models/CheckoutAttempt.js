const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['products', 'subscription'], required: true },
  key: { type: String, required: true }, hash: { type: String, required: true },
  state: { type: String, enum: ['processing', 'created', 'rejected', 'invalidated'], default: 'processing' },
  revision: { type: Number, default: 0 }, address: mongoose.Schema.Types.Mixed,
  result: mongoose.Schema.Types.Mixed, error: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ userId: 1, kind: 1, key: 1 }, { unique: true });
schema.index({ createdAt: 1 });
// No TTL: tombstones and replay results must outlive delayed requests.
module.exports = mongoose.model('CheckoutAttempt', schema);
