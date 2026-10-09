const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestKey: { type: String, required: true }, requestHash: { type: String, required: true },
  paymentCode: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['products', 'subscription'], default: 'products' },
  orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription' },
  totalAmount: { type: Number, required: true }, paymentMethod: { type: String, enum: ['cod', 'online'], required: true },
  state: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  expiresAt: { type: Date, required: true }, couponCode: String,
  couponReleased: { type: Boolean, default: false }, paidReferenceCode: String,
  overpaidAmount: { type: Number, default: 0 }, revision: { type: Number, default: 0 },
  // Kept after completion so a network retry returns the same checkout.
  result: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ userId: 1, requestKey: 1 }, { unique: true });
schema.index({ state: 1, paymentMethod: 1, expiresAt: 1 });
module.exports = mongoose.model('Checkout', schema);
