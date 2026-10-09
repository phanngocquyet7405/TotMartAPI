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

    nextDeliveries: { type: Date, default: null, required: function () { return this.status === "active"; } },
    lastDeliveries: { type: Date, default: null },

    status: {
      type: String,
      enum: ["pending_payment", "active", "cancelled", "expired"],
      default: "pending_payment",
    },
    paymentCode: { type: String, unique: true, sparse: true },
    paymentStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
    paidAt: Date, fulfillmentRevision: { type: Number, default: 0 },
    refundStatus: { type: String, enum: ["not_applicable", "pending", "completed"], default: "not_applicable" },
    refundAmount: { type: Number, default: 0 }, refundReference: String, refundedAt: Date,
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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

userSubscriptionSchema.index({ status: 1, nextDeliveries: 1 });
module.exports = mongoose.model("UserSubscription", userSubscriptionSchema);
