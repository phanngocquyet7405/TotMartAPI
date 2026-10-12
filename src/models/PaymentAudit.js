const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, enum: ['webhook', 'worker', 'admin', 'system'], required: true },
  action: { type: String, required: true }, reason: { type: String, required: true, maxlength: 500 },
  checkoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Checkout' },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
module.exports = mongoose.model('PaymentAudit', schema);
