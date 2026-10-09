const Cart = require("../models/Cart");
const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const Product = require("../models/Product");

// Giá bán thực tế — phải khớp buildOrderProductsFromCart trong checkOutController
function getUnitPrice(product) {
  return product.salePercent > 0
    ? Math.round(product.price * (1 - product.salePercent / 100))
    : product.price;
}

async function refreshTotal(cart) {
  await cart.populate('items.productId', 'price salePercent');
  await cart.populate('items.subscriptionPlanId', 'discountPrice');
  await cart.populate('items.boxId', 'value');
  cart.totalPrice = cart.items.reduce((sum, item) => sum + item.quantity * (item.boxId ? Math.round(item.boxId.value) : item.productId ? getUnitPrice(item.productId) : Math.round(item.subscriptionPlanId?.discountPrice || 0)), 0);
}
class CartController {
  // PUT /carts/sync — thay thế TOÀN BỘ giỏ sản phẩm của user bằng danh sách FE gửi lên.
  // Idempotent: gọi bao nhiêu lần cũng ra cùng kết quả (khác add-to-cart là cộng dồn).
  async syncCart(req, res, next) {
    try {
      const { items, version } = req.validatedBody;
      const filter = { userId: req.userId, isSubscribeCart: false }, merged = new Map();
      for (const item of items) { const field = item.boxId ? 'boxId' : 'productId', id = item[field], key = field + ':' + id; const prev = merged.get(key); merged.set(key, { [field]: id, quantity: Math.min((prev?.quantity || 0) + item.quantity, 999) }); }
      const cartItems = [], skipped = []; let totalPrice = 0;
      for (const item of merged.values()) {
        const doc = item.boxId ? await require('../models/Box').findById(item.boxId) : await Product.findById(item.productId);
        if (!doc) { skipped.push(item.boxId || item.productId); continue; }
        cartItems.push(item); totalPrice += item.quantity * (item.boxId ? Math.round(doc.value) : getUnitPrice(doc));
      }
      const current = await Cart.findOne(filter);
      if (version !== undefined && version !== (current?.__v || 0)) return res.status(409).json({ success: false, message: 'Giỏ đã thay đổi ở thiết bị khác. Vui lòng tải lại.' });
      if (!cartItems.length) { await Cart.deleteOne(current ? { _id: current._id, __v: current.__v } : filter); return res.json({ success: true, data: null, skipped, version: 0 }); }
      let cart;
      if (current) {
        cart = await Cart.findOneAndUpdate({ _id: current._id, __v: current.__v }, { $set: { items: cartItems, totalPrice }, $inc: { __v: 1 } }, { new: true });
        if (!cart) return res.status(409).json({ success: false, message: 'Giỏ vừa thay đổi. Vui lòng tải lại.' });
      } else cart = await Cart.create({ ...filter, items: cartItems, totalPrice });
      res.json({ success: true, data: cart, skipped, version: cart.__v });
    } catch (err) { if (err.code === 11000) err.statusCode = 409; next(err); }
  }

  async addToCart(req, res, next) {
    try {
      if (req.user) {
        const { productId, quantity } = req.validatedBody;
        const userId = req.userId; // safely taken from token

        const product = await Product.findById(productId);
        if (!product) {
          return res
            .status(404)
            .json({ success: false, message: "Product not found" });
        }

        const cart = await Cart.findOne({
          userId,
          isSubscribeCart: false,
        }).populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock");
        if (cart) {
          const item = cart.items.find(
            (item) =>
              item.productId && item.productId._id.toString() === productId,
          );
          if (item) {
            item.quantity += quantity;
          } else {
            cart.items.push({ productId, quantity });
          }
          cart.totalPrice += quantity * getUnitPrice(product);
          await refreshTotal(cart);
      await cart.save();
          res.status(200).json({
            success: true,
            message: "Item added to cart successfully",
            data: cart,
          });
        } else {
          const newCart = new Cart({
            userId,
            items: [{ productId, quantity }],
            totalPrice: quantity * getUnitPrice(product),
            isSubscribeCart: false,
          });
          await newCart.save();
          res.status(201).json({
            success: true,
            message: "Cart created successfully",
            data: newCart,
          });
        }
      } else {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }
    } catch (error) {
      next(error);
    }
  }

  async getAllCart(req, res, next) {
    try {
      const carts = await Cart.find()
        .populate("userId", "name email")
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock");
      res.status(200).json({
        success: true,
        message: "Carts retrieved successfully",
        data: carts,
      });
    } catch (error) {
      next(error);
    }
  }

  async getCartByUser(req, res, next) {
    try {
      // Priority: user's own cart via token, fallback to param if they really passed one
      const userId = req.userId || req.params._id;
      const cart = await Cart.findOne({ userId, isSubscribeCart: false })
        .populate("userId", "name email")
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock");
      res.status(200).json({
        success: true,
        message: "Cart retrieved successfully",
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteFromCart(req, res, next) {
    try {
      const productId = req.params._id || req.body.productId;
      const userId = req.userId;
      const cart = await Cart.findOne({
        userId,
        isSubscribeCart: false,
      }).populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock");
      if (cart) {
        const item = cart.items.find(
          (item) =>
            item.productId && item.productId._id.toString() === productId,
        );
        if (item) {
          cart.items.pull(item);
          cart.totalPrice -= item.quantity * getUnitPrice(item.productId);
          // Prevent negative price due to floating point or data inconsistency
          if (cart.totalPrice < 0) cart.totalPrice = 0;
          await refreshTotal(cart);
      await cart.save();
          res.status(200).json({
            success: true,
            message: "Item deleted from cart successfully",
            data: cart,
          });
        } else {
          res.status(404).json({
            success: false,
            message: "Item not found in cart",
          });
        }
      } else {
        res.status(404).json({
          success: false,
          message: "Cart not found",
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async updateCart(req, res, next) {
    try {
      const productId = req.params._id || req.validatedBody.productId;
      const { quantity } = req.validatedBody;
      const userId = req.userId;

      const product = await Product.findById(productId);
      if (!product)
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });

      const cart = await Cart.findOne({
        userId,
        isSubscribeCart: false,
      }).populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock");
      if (cart) {
        const item = cart.items.find(
          (item) =>
            item.productId && item.productId._id.toString() === productId,
        );
        if (item) {
          cart.totalPrice += (quantity - item.quantity) * product.price;
          item.quantity = quantity;
        } else {
          cart.items.push({ productId, quantity });
          cart.totalPrice += quantity * getUnitPrice(product);
        }

        if (cart.totalPrice < 0) cart.totalPrice = 0;
        await refreshTotal(cart);
      await cart.save();
        res.status(200).json({
          success: true,
          message: "Item updated in cart successfully",
          data: cart,
        });
      } else {
        const newCart = new Cart({
          userId,
          items: [{ productId, quantity }],
          totalPrice: quantity * getUnitPrice(product),
          isSubscribeCart: false,
        });
        await newCart.save();
        res.status(201).json({
          success: true,
          message: "Cart created successfully",
          data: newCart,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async addSubscribeCart(req, res, next) {
    try {
      const { subscriptionPlanId, quantity } = req.body;
      const subscribePlan =
        await SubscriptionTemplate.findById(subscriptionPlanId);

      if (!subscribePlan) {
        return res
          .status(404)
          .json({ success: false, message: "Subscribe plan not found" });
      }

      const cart = await Cart.findOne({
        userId: req.userId,
        isSubscribeCart: true,
      })
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock")
        .populate("items.subscriptionPlanId", "name basePrice discountPrice");

      if (cart) {
        const subscribeItem = cart.items.find(
          (item) =>
            item.subscriptionPlanId &&
            item.subscriptionPlanId._id.toString() === subscriptionPlanId,
        );

        cart.totalPrice += quantity * Math.round(subscribePlan.discountPrice);
        if (cart.totalPrice < 0) cart.totalPrice = 0;

        if (subscribeItem) {
          subscribeItem.quantity += quantity;
        } else {
          cart.items.push({ subscriptionPlanId, quantity });
        }
        await refreshTotal(cart);
      await cart.save();
        return res.status(200).json({
          success: true,
          message: "Item added to subscribe cart successfully",
          data: cart,
        });
      } else {
        const newCart = new Cart({
          userId: req.userId,
          items: [{ subscriptionPlanId, quantity }],
          totalPrice: quantity * Math.round(subscribePlan.discountPrice),
          isSubscribeCart: true,
        });
        await newCart.save();
        return res.status(201).json({
          success: true,
          message: "Subscribe cart created successfully",
          data: newCart,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async getSubscribeCartByUser(req, res, next) {
    try {
      const userId = req.userId || req.params._id;
      const cart = await Cart.findOne({ userId, isSubscribeCart: true })
        .populate("userId", "name email")
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock")
        .populate("items.subscriptionPlanId", "name basePrice discountPrice");
      if (!cart) {
        return res.status(200).json({
          success: true,
          message: "Cart is empty",
          data: null,
          gift: [],
        });
      }
      const gift = await SubscriptionTemplate.find({
        _id: { $in: cart.items.map((item) => item.subscriptionPlanId) },
      }).populate("gift.boxId", "name price");
      res.status(200).json({
        success: true,
        message: "Subscribe cart retrieved successfully",
        data: cart,
        gift: gift,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteFromSubscribeCart(req, res, next) {
    try {
      const subscriptionPlanId = req.params._id || req.body.subscriptionPlanId;
      const cart = await Cart.findOne({
        userId: req.userId,
        isSubscribeCart: true,
      })
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock")
        .populate("items.subscriptionPlanId", "name basePrice discountPrice");
      if (cart) {
        const subscribeItem = cart.items.find(
          (item) =>
            item.subscriptionPlanId &&
            item.subscriptionPlanId._id.toString() === subscriptionPlanId,
        );
        if (subscribeItem) {
          cart.items.pull(subscribeItem);
          cart.totalPrice -=
            subscribeItem.quantity * Math.round(subscribeItem.subscriptionPlanId.discountPrice); // Assuming basePrice is the price for the subscription plan
          if (cart.totalPrice < 0) cart.totalPrice = 0;
          await refreshTotal(cart);
      await cart.save();
          res.status(200).json({
            success: true,
            message: "Item deleted from subscribe cart successfully",
            data: cart,
          });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Item not found in cart" });
        }
      } else {
        res.status(404).json({
          success: false,
          message: "Subscribe cart not found",
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async updateSubscribeCart(req, res, next) {
    try {
      const subscriptionPlanId = req.params._id || req.body.subscriptionPlanId;
      const { quantity } = req.body;

      const subscribePlan =
        await SubscriptionTemplate.findById(subscriptionPlanId);
      if (!subscribePlan) {
        return res
          .status(404)
          .json({ success: false, message: "Subscribe plan not found" });
      }

      const cart = await Cart.findOne({
        userId: req.userId,
        isSubscribeCart: true,
      })
        .populate("items.productId", "name price images salePercent stock instock")
        .populate("items.boxId", "name value images stock")
        .populate("items.subscriptionPlanId", "name basePrice discountPrice");

      if (cart) {
        const subscribeItem = cart.items.find(
          (item) =>
            item.subscriptionPlanId &&
            item.subscriptionPlanId._id.toString() === subscriptionPlanId,
        );

        if (subscribeItem) {
          cart.totalPrice +=
            (quantity - subscribeItem.quantity) * subscribePlan.basePrice;
          subscribeItem.quantity = quantity;
        } else {
          cart.items.push({ subscriptionPlanId, quantity });
          cart.totalPrice += quantity * Math.round(subscribePlan.discountPrice);
        }

        if (cart.totalPrice < 0) cart.totalPrice = 0;
        await refreshTotal(cart);
      await cart.save();
        res.status(200).json({
          success: true,
          message: "Item updated in subscribe cart successfully",
          data: cart,
        });
      } else {
        const newCart = new Cart({
          userId: req.userId,
          items: [{ subscriptionPlanId, quantity }],
          totalPrice: quantity * Math.round(subscribePlan.discountPrice),
          isSubscribeCart: true,
        });
        await newCart.save();
        return res.status(201).json({
          success: true,
          message: "Subscribe cart created successfully",
          data: newCart,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async addSubscribePlanToCart(req, res, next) {
    return this.addSubscribeCart(req, res, next);
  }
}

module.exports = new CartController();
