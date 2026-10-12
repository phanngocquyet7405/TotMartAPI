const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  checkoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Checkout' },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentEvent' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription' },
  purpose: { type: String, enum: ['surplus', 'unpaid', 'receipt', 'order', 'subscription'], required: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  bankReference: { type: String, unique: true, sparse: true },
  evidence: String, completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, completedAt: Date,
}, { timestamps: true });
schema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('ReceiptRefund', schema);
