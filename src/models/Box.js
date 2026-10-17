const mongoose = require("mongoose");
const boxSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true, index: true },
    internalSubscription: { type: Boolean, default: false },
    subscriptionOnly: { type: Boolean, default: false },
    sourceComboId: { type: mongoose.Schema.Types.ObjectId, ref: "Box", immutable: true },
    sourceComboVersion: Number,
    giftPolicy: {
      bulkTiers: [{ _id: false, minQuantity: Number, percent: Number }],
      amenities: [{ _id: false, name: String, fee: Number }],
    },
    definitionVersion: { type: Number, default: 1, min: 1 },
    obligationRevision: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
    name: { type: String, required: true },
    stock: { type: Number, required: true },
    descriptions: { type: String, required: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    products: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: { type: Number, default: 1 },
        price: { type: Number, default: 0 },
        name: { type: String },
      },
    ],
    totalItem: { type: Number },
    value: { type: Number, required: true },
    images: [
      {
        url: { type: String, required: true },
        public_id: { type: String, required: true },
      },
    ],
    isGift: { type: Boolean, default: false },
    discountPercent: { type: Number, default: 0 },
  },
  {
    toJSON: {
      transform: (doc, ret) => {
        ret.descriptions = require("../utils/safeHtml")(ret.descriptions);
        return ret;
      },
    },
    timestamps: true,
  },
);
boxSchema.index({ archivedAt: 1, isGift: 1, validTo: 1 });
boxSchema.index({ ownerId: 1, archivedAt: 1, isGift: 1, createdAt: -1 });
module.exports = mongoose.model("Box", boxSchema);
