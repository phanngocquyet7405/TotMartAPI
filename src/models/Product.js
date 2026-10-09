const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");

const productSchema = new mongoose.Schema(
  {
    productId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    price: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    description: { type: String },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    instock: { type: Boolean, default: true },
    stock: { type: Number, default: 0 },
    images: [
      {
        url: { type: String, required: true },
        public_id: { type: String, required: true },
      },
    ],
    salePercent: { type: Number, default: 0, min: 0, max: 100 },
    details: { type: String },
    rate: { type: Number, default: 0 },
    slug: { type: String, slug: "name", unique: true },
    views: { type: Number, default: 0 },
    selledNumber: { type: Number, default: 0 },
  },
  {
    toJSON: { transform: (doc, ret) => { if (ret.description !== undefined) ret.description = require("../utils/safeHtml")(ret.description); return ret; } },
    timestamps: true, optimisticConcurrency: true,
  },
);
productSchema.index({ brand: 1, category: 1 });
productSchema.index({ instock: 1, stock: -1 });

mongoose.plugin(slug);
module.exports = mongoose.model("Product", productSchema);
