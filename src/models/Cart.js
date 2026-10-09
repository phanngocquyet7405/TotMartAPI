const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        subscriptionPlanId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SubscriptionTemplate",
        },
        boxId: { type: mongoose.Schema.Types.ObjectId, ref: "Box" },
        quantity: { type: Number },
      },
    ],
    totalPrice: { type: Number, required: true },
    isSubscribeCart: { type: Boolean, default: false },
  },
  {
    timestamps: true, optimisticConcurrency: true,
  },
);

cartSchema.index({ userId: 1, isSubscribeCart: 1 }, { unique: true });
module.exports = mongoose.model("Cart", cartSchema);
