const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "new_order",
        "payment_received",
        "order_cancelled",
        "payment_underpaid",
      ],
      required: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderCode: { type: String, required: true },

    message: { type: String, required: true },

    meta: {
      totalAmount: { type: Number },
      paymentMethod: { type: String },
      customerName: { type: String },
    },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    readBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({ isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
