const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true }, type: { type: String, required: true },
  state: { type: String, enum: ['pending', 'delivered'], default: 'pending' },
  leaseUntil: { type: Date, default: new Date(0) }, nextAttempt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }, deliveredAt: Date,
}, { timestamps: true });
schema.index({ state: 1, nextAttempt: 1, leaseUntil: 1 });
module.exports = mongoose.model('NotificationOutbox', schema);
