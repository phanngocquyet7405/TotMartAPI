const mongoose = require('mongoose');

const subcribePlanSchema = new mongoose.Schema(
  {
    name: { type: String, require: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', require: true },
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', require: true },
    planType: { type: String, enum: ['1_month', '3_month', '6_month', '12_month'], require: true },

    currentPeriodStart: { type: Date, require: true },
    currentPeriodEnd: { type: Date, require: true },

    totalDeliveries: { type: Number, require: true },
    completeDeliveries: { type: Number, default: 0 },
    remainDeliveries: { type: Number, require: true },

    nextDeliveries: { type: Date, require: true },
    lastDeliveries: { type: Date, default: null },

    status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },

    cancelAtPeriodEnd: { type: Boolean, default: false },

    shippingAddress: {
      address: { type: String, require: true },
      district: { type: String, require: true },
      city: { type: String, require: true },
      country: { type: String, require: true },
      zipCode: { type: String, require: true },
      phone: { type: String, require: true },
    },

    price: { type: Number, require: true },
    oldPrice: { type: Number, required: true },
    discount: { type: Number, required: true },
    discountPercent: { type: Number, required: true },
    gift: [
      {
        boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box' },
        quantity: { type: Number, default: 1 },
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('SubscribePlan', subcribePlanSchema);
