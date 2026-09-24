const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    customerEmail: { type: String },

    products: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        unitPrice: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
        totalPrice: { type: Number, required: true },
      },
    ],

    orderId: { type: String, required: true, unique: true },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
        "on_hold",
      ],
      default: "pending",
    },

    stockDeducted: { type: Boolean, default: false },
    totalAmount: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    isOverpaid: { type: Boolean, default: false },
    overpaidAmount: { type: Number, default: 0 },

    shippingAddress: {
      fullName: { type: String },
      phone: { type: String },
      address: { type: String },
      district: { type: String },
      city: { type: String },
      country: { type: String },
      zipCode: { type: String },
    },

    paymentMethod: { type: String, enum: ["cod", "online"], default: "cod" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paidReferenceCode: { type: String, unique: true, sparse: true },

    note: { type: String },
    couponCode: { type: String },

    confirmedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },

    cancelReason: { type: String, default: null },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    paymentCode: { type: String, required: true },

    refundStatus: {
      type: String,
      enum: ["not_applicable", "pending", "completed"],
      default: "not_applicable",
    },
    refundAmount: { type: Number, default: null },
    refundedAt: { type: Date, default: null },

    statusHistory: [
      {
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        note: { type: String },
      },
    ],
  },
  {
    timestamps: true,
  },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, paymentMethod: 1 });
orderSchema.index({ refundStatus: 1 });

orderSchema.pre("save", function (next) {
  const now = new Date();

  if (this.isModified("status")) {
    const milestoneField = {
      processing: "confirmedAt",
      shipped: "shippedAt",
      delivered: "deliveredAt",
      cancelled: "cancelledAt",
      returned: "returnedAt",
    }[this.status];

    if (milestoneField && !this[milestoneField]) {
      this[milestoneField] = now;
    }

    this.statusHistory.push({
      status: this.status,
      changedAt: now,
      changedBy: this._statusChangedBy || null,
      note: this._statusChangeNote || undefined,
    });
  }

  if (
    this.isModified("paymentStatus") &&
    this.paymentStatus === "paid" &&
    !this.paidAt
  ) {
    this.paidAt = now;
  }

  next();
});

module.exports = mongoose.model("Order", orderSchema);
