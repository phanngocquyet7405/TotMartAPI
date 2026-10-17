const commerce = require("./commercePolicy");
const { guardBox } = require("./boxDefinitionService");
const crypto = require("crypto");
const Product = require("../models/Product");
const Box = require("../models/Box");
const Coupon = require("../models/Coupon");

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
function unitPrice(product) {
  commerce.safeMoney(product.price);
  const percent = product.salePercent || 0;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    fail("Sale percent không hợp lệ");
  return commerce.safeMoney(Math.round(product.price * (1 - percent / 100)));
}
// Integer allocation preserves the exact total, including one-VND discounts.
function allocate(total, weights) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0)
  )
    fail("Số tiền phân bổ không hợp lệ");
  if (!weights.length) return [];
  const normalized = weights.some((w) => w > 0)
    ? weights
    : weights.map(() => 1);
  const sum = normalized.reduce((a, b) => a + BigInt(b), 0n),
    amount = BigInt(total);
  const values = normalized.map((w) => Number((amount * BigInt(w)) / sum));
  const rank = normalized
    .map((w, i) => ({ i, remainder: (amount * BigInt(w)) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.i - b.i
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (let n = total - values.reduce((a, b) => a + b, 0), i = 0; i < n; i++)
    values[rank[i].i]++;
  return values;
}
async function couponDiscount(code, subtotal, session, claim = false) {
  if (!code) return { discountAmount: 0 };
  let coupon = await Coupon.findOne({ code }).session(session || null);
  const now = new Date();
  if (
    !coupon ||
    !coupon.isActive ||
    now < coupon.startDate ||
    now > coupon.expiresAt
  )
    fail("Mã giảm giá không hợp lệ hoặc đã hết hạn");
  if (subtotal < coupon.minOrderValue)
    fail(`Đơn hàng cần tối thiểu ${coupon.minOrderValue} để dùng mã này`);
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit)
    fail("Mã giảm giá đã hết lượt sử dụng", 409);
  if (claim) {
    coupon = await Coupon.findOneAndUpdate(
      {
        _id: coupon._id,
        isActive: true,
        startDate: { $lte: now },
        expiresAt: { $gte: now },
        $expr: {
          $or: [
            { $eq: ["$usageLimit", null] },
            { $lt: ["$usedCount", "$usageLimit"] },
          ],
        },
      },
      { $inc: { usedCount: 1 } },
      { session, new: true },
    );
    if (!coupon) fail("Mã giảm giá đã hết lượt sử dụng", 409);
  }
  const amount =
    coupon.discountType === "percentage"
      ? Math.round((subtotal * coupon.discount) / 100)
      : coupon.discount;
  return {
    discountAmount: Math.min(subtotal, Math.round(amount)),
    couponCode: coupon.code,
  };
}
async function buildQuote(items, couponCode, session = null, claim = false) {
  const normalized = commerce.normalizeLines(items);
  if (!normalized.length) fail("Giỏ hàng trống");
  const boxIds = [
    ...new Set(normalized.filter((i) => i.boxId).map((i) => String(i.boxId))),
  ].sort();
  const boxMap = new Map();
  if (claim) {
    // Serial shared writes in stable order inside transaction. These are locks, not N+1 reads.
    for (const id of boxIds) boxMap.set(id, await guardBox(id, session));
  } else if (boxIds.length) {
    for (const box of await Box.find({
      _id: { $in: boxIds },
      archivedAt: null,
    }).session(session))
      boxMap.set(String(box._id), box);
  }
  const ids = new Set(
    normalized.filter((i) => i.productId).map((i) => String(i.productId)),
  );
  const boxDemand = new Map();
  for (const item of normalized.filter((i) => i.boxId))
    boxDemand.set(
      String(item.boxId),
      (boxDemand.get(String(item.boxId)) || 0) + item.quantity,
    );
  const now = new Date();
  for (const id of boxIds) {
    const box = boxMap.get(id);
    if (
      !box ||
      box.validFrom > now ||
      box.validTo < now ||
      (box.isGift && !box.sourceComboId) ||
      box.internalSubscription ||
      !Number.isSafeInteger(box.stock) ||
      box.stock < boxDemand.get(id) ||
      !box.products.length
    )
      fail("Hộp không còn bán hoặc không đủ hàng");
    for (const part of box.products) {
      if (!Number.isSafeInteger(part.quantity) || part.quantity < 1)
        fail("Cấu hình hộp không hợp lệ");
      ids.add(String(part.productId));
    }
  }
  const docs = await Product.find({ _id: { $in: [...ids].sort() } })
    .populate("brand")
    .session(session);
  const productMap = new Map(docs.map((p) => [String(p._id), p]));
  function productFor(id) {
    const p = productMap.get(String(id));
    if (p?.archivedAt || !p?.brand?.ownerId)
      fail("Sản phẩm không tồn tại hoặc không có người bán hợp lệ");
    if (p.ownerId && String(p.ownerId) !== String(p.brand.ownerId))
      fail('Chủ sản phẩm và thương hiệu không khớp; cần đối chiếu ownership trước khi bán', 409);
    return p;
  }
  // Aggregate standalone SKU quantity across gift variants. Box components do not qualify for bulk.
  const quantities = new Map();
  for (const item of normalized.filter((i) => i.productId))
    quantities.set(
      String(item.productId),
      (quantities.get(String(item.productId)) || 0) + item.quantity,
    );
  const bulkAmounts = new Map();
  for (const [id, quantity] of quantities) {
    const variants = normalized.filter((i) => String(i.productId) === id);
    const weights = variants.map((i) =>
      commerce.safeMoney(unitPrice(productFor(id)) * i.quantity),
    );
    const discount = Math.round(
      (commerce.sum(weights) * commerce.bulkPercent(quantity)) / 100,
    );
    allocate(discount, weights).forEach((amount, index) =>
      bulkAmounts.set(variants[index].lineId, amount),
    );
  }
  const products = [],
    lines = [];
  for (const item of normalized) {
    let fee = commerce.safeMoney(
      commerce.fees[item.gift.wrap] * item.quantity,
    );
    if (item.boxId) {
      const box = boxMap.get(String(item.boxId));
      const parts = box.products.map((c) => ({
        product: productFor(c.productId),
        quantity: c.quantity * item.quantity,
      }));
      const baseAmount = commerce.safeMoney(Math.round(box.value) * item.quantity);
      const percent = box.isGift ? [...(box.giftPolicy?.bulkTiers || [])]
        .filter(t => t.minQuantity <= boxDemand.get(String(box._id))).sort((a, b) => b.minQuantity - a.minQuantity)[0]?.percent || 0 : 0;
      const bulkAmount = Math.round(baseAmount * percent / 100);
      const value = commerce.safeMoney(baseAmount - bulkAmount);
      const amenitiesFee = box.isGift ? commerce.sum((box.giftPolicy?.amenities || []).map(a => commerce.safeMoney(a.fee * item.quantity))) : 0;
      fee = commerce.sum([fee, amenitiesFee]);
      const amounts = allocate(
        value,
        parts.map((c) => commerce.safeMoney(unitPrice(c.product) * c.quantity)),
      );
      const giftFees = allocate(fee, amounts);
      const bulkParts = allocate(bulkAmount, amounts);
      parts.forEach((part, index) =>
        products.push({
          productId: part.product._id,
          name: `${part.product.name} (${box.name})`,
          unitPrice: amounts[index] / part.quantity,
          quantity: part.quantity,
          totalPrice: amounts[index],
          brand: part.product.brand._id,
          merchantId: part.product.brand.ownerId,
          boxId: box._id,
          lineId: item.lineId,
          gift: item.gift,
          giftFee: giftFees[index],
          bulkDiscountAmount: bulkParts[index],
        }),
      );
      lines.push({
        itemType: "box",
        itemId: String(box._id),
        lineId: item.lineId,
        name: box.name,
        quantity: item.quantity,
        unitPrice: Math.round(box.value),
        baseAmount,
        bulkPercent: percent,
        bulkDiscountAmount: bulkAmount,
        totalPrice: value,
        gift: item.gift,
        giftFee: fee,
      });
    } else {
      const p = productFor(item.productId),
        price = unitPrice(p),
        base = commerce.safeMoney(price * item.quantity),
        discount = bulkAmounts.get(item.lineId) || 0;
      products.push({
        productId: p._id,
        name: p.name,
        unitPrice: price,
        quantity: item.quantity,
        totalPrice: base - discount,
        brand: p.brand._id,
        merchantId: p.brand.ownerId,
        lineId: item.lineId,
        gift: item.gift,
        giftFee: fee,
        bulkDiscountAmount: discount,
      });
      lines.push({
        itemType: "product",
        itemId: String(p._id),
        lineId: item.lineId,
        name: p.name,
        quantity: item.quantity,
        unitPrice: price,
        baseAmount: base,
        bulkPercent: commerce.bulkPercent(quantities.get(String(p._id))),
        bulkDiscountAmount: discount,
        totalPrice: base - discount,
        gift: item.gift,
        giftFee: fee,
      });
    }
  }
  const demand = new Map();
  for (const p of products)
    demand.set(
      String(p.productId),
      (demand.get(String(p.productId)) || 0) + p.quantity,
    );
  for (const [id, quantity] of demand) {
    const p = productFor(id);
    if (
      !Number.isSafeInteger(quantity) ||
      !Number.isSafeInteger(p.stock) ||
      p.instock === false ||
      p.stock < quantity
    )
      fail("Một sản phẩm trong giỏ không đủ hàng");
  }
  const boxes = boxIds.map((id) => ({
    boxId: boxMap.get(id)._id,
    name: boxMap.get(id).name,
    quantity: boxDemand.get(id),
  }));
  const baseSubtotal = commerce.sum(lines.map((l) => l.baseAmount)),
    bulkDiscountAmount = commerce.sum(lines.map((l) => l.bulkDiscountAmount));
  const subtotal = commerce.sum(products.map((p) => p.totalPrice)),
    giftFee = commerce.sum(lines.map((l) => l.giftFee));
  const discount = await couponDiscount(couponCode, subtotal, session, claim);
  commerce.safeMoney(discount.discountAmount);
  const shippingFee = 0; // Customer pays the carrier directly; never collect this in COD/QR.
  const totalAmount = commerce.sum([
    subtotal - discount.discountAmount,
    shippingFee,
    giftFee,
  ]);
  const policyVersion = commerce.policy().version;
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        policyVersion,
        lines,
        couponCode: discount.couponCode,
        subtotal,
        giftFee,
        shippingFee,
        discountAmount: discount.discountAmount,
        totalAmount,
      }),
    )
    .digest("hex");
  return {
    products,
    boxes,
    lines,
    baseSubtotal,
    bulkDiscountAmount,
    subtotal,
    giftFee,
    shippingFee,
    shippingMode: 'separate', // Compatibility alias; shippingPayment is canonical.
    shippingPayment: 'customer_to_carrier',
    shippingFeeIncluded: false,
    ...discount,
    totalAmount,
    fingerprint,
    policyVersion,
  };
}
module.exports = { unitPrice, allocate, couponDiscount, buildQuote, fail };
