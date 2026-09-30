const mongoose = require("mongoose");

const userSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionTemplate",
      required: true,
    },
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: "Box", required: true },
    planType: {
      type: String,
      enum: ["1_month", "3_month", "6_month", "12_month"],
      required: true,
    },

    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },

    totalDeliveries: { type: Number, required: true },
    completeDeliveries: { type: Number, default: 0 },
    remainDeliveries: { type: Number, required: true },

    nextDeliveries: { type: Date, required: true },
    lastDeliveries: { type: Date, default: null },

    status: {
      type: String,
      enum: ["active", "cancelled", "expired"],
      default: "active",
    },
    cancelAtPeriodEnd: { type: Boolean, default: false },

    shippingAddress: {
      address: { type: String, required: true },
      district: { type: String, required: true },
      city: { type: String, required: true },
      country: { type: String, required: true },
      // Không bắt buộc: địa chỉ đã lưu của user không có zipCode (Việt Nam ít dùng)
      zipCode: { type: String, default: "" },
      phone: { type: String, required: true },
    },

    price: { type: Number, required: true },
    oldPrice: { type: Number, required: true },
    discount: { type: Number, required: true },
    discountPercent: { type: Number, required: true },

    gift: [
      {
        boxId: { type: mongoose.Schema.Types.ObjectId, ref: "Box" },
        quantity: { type: Number, default: 1 },
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("UserSubscription", userSubscriptionSchema);
