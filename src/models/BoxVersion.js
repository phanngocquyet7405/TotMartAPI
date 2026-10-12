const mongoose = require('mongoose');
const partSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  price: { type: Number, required: true, min: 0 },
  name: { type: String, required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  boxId: { type: mongoose.Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  definition: {
    name: { type: String, required: true }, descriptions: String,
    products: { type: [partSchema], required: true },
    value: { type: Number, required: true, min: 0 },
    totalItem: Number, isGift: Boolean, discountPercent: Number,
    validFrom: Date, validTo: Date,
    images: [{ _id: false, url: String, public_id: String }],
  },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ boxId: 1, version: 1 }, { unique: true });
// Application guard. Raw MongoDB writes/collection APIs bypass Mongoose hooks.
schema.pre('save', function(next) {
  if (!this.isNew) return next(new Error('BoxVersion is immutable'));
  next();
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate',
  'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function(next) { next(new Error('BoxVersion is immutable')); });
}
module.exports = mongoose.model('BoxVersion', schema);
