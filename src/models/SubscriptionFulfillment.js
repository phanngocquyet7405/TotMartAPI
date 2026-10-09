const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sequence: { type: Number, required: true }, dueAt: { type: Date, required: true },
  state: { type: String, enum: ['pending', 'dispatched', 'delivered', 'cancelled'], default: 'pending' },
  products: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, quantity: Number, name: String }],
  boxes: [{ boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box' }, quantity: Number, name: String }],
  dispatchedAt: Date, deliveredAt: Date, trackingReference: String,
  deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ subscriptionId: 1, sequence: 1 }, { unique: true });
schema.index({ state: 1, dueAt: 1 });
module.exports = mongoose.model('SubscriptionFulfillment', schema);
