const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  tokenVersion: Number, sessionId: String, reason: { type: String, required: true },
  state: { type: String, enum: ['pending','published'], default: 'pending' },
  leaseId: String, leaseUntil: { type: Date, default: () => new Date(0) },
  nextAttempt: { type: Date, default: Date.now }, attempts: { type: Number, default: 0 }, publishedAt: Date,
}, { timestamps: true });
schema.index({ state: 1, nextAttempt: 1, leaseUntil: 1 });
module.exports = mongoose.model('SecurityOutbox', schema);
