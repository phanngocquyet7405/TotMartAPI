const mongoose = require('mongoose');
const Product = require('../models/Product');
const Box = require('../models/Box');
const Template = require('../models/SubscriptionTemplate');
const Order = require('../models/Order');
const catalog = require('../services/managerCatalogService');
const { adjustStock } = require('../services/stockAdjustment');
const orderPolicy = require('../services/merchantOrderPolicy');
const logger = require('../utils/logger');
const cloudinary = require('cloudinary').v2;
const escape = input => String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1), limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));
  return { page, limit };
}
async function list(Model, filter, query, res, { present = x => x, populate, meta } = {}) {
  const { page, limit } = pagination(query);
  let request = Model.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
  if (populate) request = request.populate(populate);
  const [rows, total] = await Promise.all([request, Model.countDocuments(filter)]);
  res.json({ success: true, data: rows.map(present), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, ...(meta ? { meta } : {}) });
}
const ORDER_FIELDS = ['_id', 'orderId', 'createdAt', 'updatedAt', 'status', 'paymentMethod', 'paymentStatus', 'products',
  'totalAmount', 'shippingFee', 'shippingPayment', 'giftFee', 'bulkDiscountAmount', 'discountAmount', 'shippingAddress', 'trackingReference',
  'confirmedAt', 'shippedAt', 'deliveredAt', 'codCollectionStatus', 'statusHistory', '__v'];
function presentOrder(order) {
  const source = order.toObject ? order.toObject() : order;
  const result = Object.fromEntries(ORDER_FIELDS.filter(k => source[k] !== undefined).map(k => [k, source[k]]));
  // Actor IDs/history are scoped to this order; no customer email, bank/refund evidence or sibling orders.
  result.allowedTransitions = orderPolicy.allowedTransitions(source);
  return result;
}
async function uploadImages(files, images) {
  for (const file of files || []) {
    images.push(await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'manager-combos', resource_type: 'image', format: 'webp' },
        (error, result) => error ? reject(error) : resolve({ url: result.secure_url, public_id: result.public_id }));
      stream.on('error', reject); stream.end(file.buffer);
    }));
  }
}
async function cleanUploads(images) {
  for (const image of images) try { await cloudinary.uploader.destroy(image.public_id); } catch { logger.warn('Manager image cleanup requires retry'); }
}
module.exports = {
  async options(req, res) { res.json({ success: true, data: await catalog.catalogOptions(req.userId) }); },
  async createBrand(req, res) {
    const data = await require('../models/Brand').create({ name: req.validatedBody.name, ownerId: req.userId });
    res.status(201).json({ success: true, data });
  },
  async products(req, res) {
    const filter = await catalog.productScope(req.userId), query = req.query;
    if (query.brand) {
      if (!mongoose.isObjectIdOrHexString(query.brand)) catalog.fail('ID thương hiệu không hợp lệ');
      await catalog.requireBrand(req.userId, query.brand); filter.brand = query.brand;
    }
    if (query.category) {
      if (!mongoose.isObjectIdOrHexString(query.category)) catalog.fail('ID danh mục không hợp lệ');
      filter.category = query.category;
    }
    if (query.keyword) filter.name = { $regex: escape(String(query.keyword).slice(0, 100)), $options: 'i' };
    for (const [key, op] of [['minPrice', '$gte'], ['maxPrice', '$lte']]) if (query[key] !== undefined) {
      const value = Number(query[key]); if (!Number.isSafeInteger(value) || value < 0) catalog.fail('Khoảng giá không hợp lệ');
      filter.price = { ...filter.price, [op]: value };
    }
    if (filter.price?.$gte > filter.price?.$lte) catalog.fail('Khoảng giá không hợp lệ');
    return list(Product, filter, query, res);
  },
  async productStock(req, res) {
    const scope = await catalog.productScope(req.userId);
    const data = await adjustStock(Product, req.params.id, req.validatedBody.delta, { scope, withInstock: true });
    logger.info({ actorId: req.userId, productId: req.params.id, ...req.validatedBody }, 'Merchant stock adjustment');
    res.json({ success: true, data });
  },
  async combos(req, res) {
    const kind = req.managerKind || req.query.kind || 'combo';
    if (!['combo', 'gift'].includes(kind)) catalog.fail('kind phải là combo hoặc gift');
    return list(Box, { ownerId: req.userId, archivedAt: null, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true }, isGift: kind === 'gift' }, req.query, res);
  },
  async createCombo(req, res) {
    const images = []; let saved = false;
    try {
      await catalog.buildParts(req.userId, req.validatedBody.products, null);
      await uploadImages(req.files, images);
      const data = await catalog.createCombo(req.userId, req.validatedBody, images); saved = true;
      res.status(201).json({ success: true, data });
    } finally { if (!saved) await cleanUploads(images); }
  },
  async updateCombo(req, res) {
    const box = await Box.findOne({ _id: req.params.id, ownerId: req.userId, archivedAt: null, isGift: false, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true } });
    if (!box) catalog.fail('Combo không tồn tại trong cửa hàng', 404);
    const images = []; let saved = false;
    try {
      await uploadImages(req.files, images);
      const data = await catalog.updateCombo(req.userId, box, req.validatedBody, images); saved = true;
      res.json({ success: true, data });
    } finally { if (!saved) await cleanUploads(images); }
  },
  async createGift(req, res) { res.status(201).json({ success: true, data: await catalog.createGift(req.userId, req.validatedBody) }); },
  async updateGift(req, res) {
    const box = await Box.findOne({ _id: req.params.id, ownerId: req.userId, archivedAt: null, isGift: true });
    if (!box) catalog.fail('Gift không tồn tại trong cửa hàng', 404);
    if (req.validatedBody.validTo) {
      const source = await Box.findById(box.sourceComboId);
      if (!source || req.validatedBody.validTo > source.validTo) catalog.fail('Gift không được hết hạn sau combo nguồn');
    }
    res.json({ success: true, data: await require('../services/boxDefinitionService').changeDefinition(box._id, req.validatedBody, { ownerId: req.userId }) });
  },
  async boxStock(req, res) {
    const scope = { ownerId: req.userId, archivedAt: null, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true } };
    const data = await adjustStock(Box, req.params.id, req.validatedBody.delta, { scope });
    logger.info({ actorId: req.userId, boxId: req.params.id, ...req.validatedBody }, 'Merchant package stock adjustment');
    res.json({ success: true, data });
  },
  async deleteBox(req, res) {
    const box = await Box.findOne({ _id: req.params.id, ownerId: req.userId, archivedAt: null, internalSubscription: { $ne: true }, subscriptionOnly: { $ne: true } });
    if (!box) catalog.fail('Combo không tồn tại trong cửa hàng', 404);
    res.json({ success: true, data: await catalog.archiveBox(req.userId, box) });
  },
  async subscriptions(req, res) {
    return list(Template, { ownerId: req.userId, archivedAt: null }, req.query, res,
      { populate: { path: 'boxId', select: 'name value internalSubscription' }, present: catalog.presentTemplate });
  },
  async createSubscription(req, res) { res.status(201).json({ success: true, data: await catalog.createTemplate(req.userId, req.validatedBody) }); },
  async createRetail(req, res) { res.status(201).json({ success: true, data: await catalog.createTemplate(req.userId, req.validatedBody, true) }); },
  async retailStock(req, res) {
    // A retired template can still have paid subscribers whose pinned deliveries must be fulfilled.
    const template = await Template.findOne({ _id: req.params.id, ownerId: req.userId, sourceType: 'retail' });
    if (!template) catalog.fail('Gói hàng lẻ không tồn tại trong cửa hàng', 404);
    const data = await adjustStock(Box, template.boxId, req.validatedBody.delta,
      { scope: { ownerId: req.userId, internalSubscription: true, archivedAt: null } });
    logger.info({ actorId: req.userId, templateId: req.params.id, ...req.validatedBody }, 'Merchant retail stock adjustment');
    res.json({ success: true, data });
  },
  async updateSubscription(req, res) { res.json({ success: true, data: await catalog.updateTemplate(req.userId, req.params.id, req.validatedBody) }); },
  async deleteSubscription(req, res) {
    const data = await Template.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId, archivedAt: null }, { isActive: false, archivedAt: new Date() }, { new: true });
    if (!data) catalog.fail('Gói không tồn tại trong cửa hàng', 404);
    res.json({ success: true, data });
  },
  async orders(req, res) {
    const filter = { merchantId: req.userId }, query = req.query;
    if (query.status) { if (!['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'on_hold'].includes(query.status)) catalog.fail('Trạng thái không hợp lệ'); filter.status = query.status; }
    if (query.paymentMethod) { if (!['online', 'cod'].includes(query.paymentMethod)) catalog.fail('Phương thức không hợp lệ'); filter.paymentMethod = query.paymentMethod; }
    if (query.search || query.keyword) filter.orderId = { $regex: escape(String(query.search || query.keyword).slice(0, 100)), $options: 'i' };
    for (const [key, op] of [['from', '$gte'], ['to', '$lte']]) if (query[key]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query[key])) catalog.fail('Ngày lọc không hợp lệ');
      const calendar = new Date(`${query[key]}T12:00:00Z`);
      if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== query[key]) catalog.fail('Ngày lọc không tồn tại');
      const value = new Date(`${query[key]}T${key === 'to' ? '23:59:59.999' : '00:00:00'}+07:00`);
      if (Number.isNaN(value.getTime())) catalog.fail('Ngày lọc không hợp lệ');
      filter.createdAt = { ...filter.createdAt, [op]: value };
    }
    if (filter.createdAt?.$gte > filter.createdAt?.$lte) catalog.fail('Ngày bắt đầu phải trước ngày kết thúc');
    if (query.includeUnpaid !== undefined && !['true', 'false', true, false].includes(query.includeUnpaid)) catalog.fail('includeUnpaid không hợp lệ');
    const hide = query.includeUnpaid !== 'true' && query.includeUnpaid !== true;
    const unpaid = { paymentMethod: 'online', paymentStatus: { $ne: 'paid' } };
    const hiddenUnpaidOnline = hide ? await Order.countDocuments({ $and: [filter, unpaid] }) : 0;
    if (hide) filter.$nor = [unpaid];
    return list(Order, filter, query, res, { present: presentOrder, meta: { hidesUnpaidOnline: hide, hiddenUnpaidOnline } });
  },
  async orderDetail(req, res) {
    const order = await Order.findOne({ _id: req.params.id, merchantId: req.userId });
    if (!order) catalog.fail('Đơn không tồn tại trong cửa hàng', 404);
    res.json({ success: true, data: presentOrder(order) });
  },
  async orderStatus(req, res) {
    let order;
    try {
      await mongoose.connection.transaction(async session => {
        order = await Order.findOne({ _id: req.params.id, merchantId: req.userId }).session(session);
        if (!order) catalog.fail('Đơn không tồn tại trong cửa hàng', 404);
        // Same lock as webhook/cancel/COD admin actions; no stale-state mutation against settlement.
        await require('../services/checkoutLifecycle').lockCheckout(order.paymentCode, session);
        if (orderPolicy.transition(order, req.validatedBody, req.userId)) await order.save({ session });
      });
    } catch (error) { if (error.name === 'VersionError') catalog.fail('Đơn đã thay đổi; vui lòng tải lại', 409); throw error; }
    res.json({ success: true, data: presentOrder(order) });
  },
};
