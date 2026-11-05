const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refreshHash: { type: String, required: true, unique: true },
  revokedAt: Date,
  history: [{ _id: false, hash: { type: String, required: true }, consumedAt: { type: Date, required: true }, retries: { type: Number, default: 0 } }],
  tokenVersion: { type: Number, required: true }, expiresAt: { type: Date, required: true }, persistent: Boolean,
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ 'history.hash': 1 });
module.exports = mongoose.model('AuthSession', schema);
