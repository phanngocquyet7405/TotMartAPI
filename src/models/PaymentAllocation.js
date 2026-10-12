const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentEvent', required: true, unique: true },
  checkoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Checkout', required: true, index: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { timestamps: { createdAt: true, updatedAt: false } });
module.exports = mongoose.model('PaymentAllocation', schema);
