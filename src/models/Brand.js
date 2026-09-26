const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, slug: "name", unique: true },
    logo: { type: String },
    // Server-managed ID used to clean up images; legacy URL-only logos still work.
    logoPublicId: { type: String, select: false },
    description: { type: String },
    cityAddress: { type: String },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Brand", brandSchema);
