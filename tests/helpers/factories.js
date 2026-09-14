const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const User = require("../../src/models/User");
const Brand = require("../../src/models/Brand");
const Product = require("../../src/models/Product");
const Cart = require("../../src/models/Cart");
const Coupon = require("../../src/models/Coupon");
const config = require("../../src/config/environment");

let seq = 0;
function uniq(prefix) {
  seq += 1;
  return `${prefix}${Date.now()}${seq}`;
}

async function createUser(overrides = {}) {
  const plainPassword = overrides.password || "Password123!";
  // Số vòng bcrypt thấp để test chạy nhanh, không ảnh hưởng tới mã sản phẩm thật
  const hashed = await bcrypt.hash(plainPassword, 4);

  const user = await User.create({
    name: overrides.name || uniq("user"),
    email: overrides.email || `${uniq("user")}@test.com`,
    password: hashed,
    role: overrides.role || "user",
    addresses: overrides.addresses || [
      {
        country: "VN",
        city: "Hồ Chí Minh",
        district: "Quận 1",
        address: "123 Đường Test",
        phone: "0900000000",
      },
    ],
  });

  return { user, plainPassword };
}

function signToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

async function createBrand(overrides = {}) {
  let ownerId = overrides.ownerId;
  if (!ownerId) {
    const { user } = await createUser({ role: "merchant" });
    ownerId = user._id;
  }
  return Brand.create({
    name: overrides.name || uniq("Brand"),
    ownerId,
  });
}

async function createProduct(brand, overrides = {}) {
  return Product.create({
    productId: overrides.productId || uniq("SKU"),
    name: overrides.name || uniq("Product"),
    price: overrides.price ?? 100000,
    brand: brand._id,
    stock: overrides.stock ?? 10,
    instock: overrides.instock ?? true,
    salePercent: overrides.salePercent ?? 0,
  });
}

async function createCartWithItems(userId, items) {
  return Cart.create({
    userId,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
    totalPrice: 0,
    isSubscribeCart: false,
  });
}

async function createCoupon(overrides = {}) {
  const now = Date.now();
  return Coupon.create({
    code: (overrides.code || uniq("SALE")).toUpperCase(),
    discount: overrides.discount ?? 10,
    discountType: overrides.discountType || "percentage",
    minOrderValue: overrides.minOrderValue ?? 0,
    startDate: overrides.startDate || new Date(now - 60 * 1000),
    expiresAt: overrides.expiresAt || new Date(now + 60 * 60 * 1000),
    usageLimit: overrides.usageLimit ?? null,
    isActive: overrides.isActive ?? true,
  });
}

module.exports = {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCartWithItems,
  createCoupon,
};
