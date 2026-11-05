const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, validate: {
      validator(value) {
        if (typeof this.isModified === 'function' && !this.isNew && !this.isModified('name')) return true;
        return typeof value === 'string' && value.length >= 3 && value.length <= 100;
      },
      message: 'Display name must contain 3 to 100 characters',
    } },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin", "merchant"],
      default: "user",
    },
    avatar: {
      url: { type: String },
      public_id: { type: String },
    },
    addresses: [
      {
        fullName: { type: String, maxlength: 120 },
        country: { type: String },
        city: { type: String },
        district: { type: String },
        address: { type: String },
        phone: { type: String },
      },
    ],
    cart: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        quantity: { type: Number, default: 1 },
        price: { type: Number, required: true },
      },
    ],
    isActive: { type: Boolean, default: true },
    refreshToken: [{ type: String }],
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    subscribePlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscribePlan",
    },
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        return ret;
      },
    },
  },
);

const identity = require('../services/userIdentityService');
userSchema.pre('validate', async function () {
  if (this.isNew || this.isModified('email')) {
    this.email = identity.canonicalEmail(this.email || '');
    await identity.assertEmailAvailable(this.constructor, this.email, this.isNew ? undefined : this._id);
  }
});
// All current query writers that actually change email (including operational fixtures)
// use the same canonical policy. Non-identity writes leave legacy email untouched.
for (const operation of ['updateOne', 'findOneAndUpdate', 'updateMany']) {
  userSchema.pre(operation, async function () {
    const update = this.getUpdate();
    const value = update?.$set?.email ?? update?.email;
    if (value === undefined) return;
    if (operation === 'updateMany') throw new Error('Bulk email changes require the reviewed identity migration');
    const existing = await this.model.findOne(this.getFilter()).select('_id').lean();
    const email = identity.canonicalEmail(value);
    await identity.assertEmailAvailable(this.model, email, existing?._id);
    if (update.$set?.email !== undefined) update.$set.email = email;
    else update.email = email;
  });
}
module.exports = mongoose.model("User", userSchema);
