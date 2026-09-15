const Cart = require("../models/Cart");
const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const Product = require("../models/Product");

class CartController {
  async addToCart(req, res, next) {
    try {
      if (req.user) {
        const { productId, quantity } = req.body;
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
        }).populate("items.productId", "name price");
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
          cart.totalPrice += quantity * product.price;
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
            totalPrice: quantity * product.price,
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
        .populate("items.productId", "name price");
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
        .populate("items.productId", "name price");
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
      }).populate("items.productId", "name price");
      if (cart) {
        const item = cart.items.find(
          (item) =>
            item.productId && item.productId._id.toString() === productId,
        );
        if (item) {
          cart.items.pull(item);
          cart.totalPrice -= item.quantity * item.productId.price;
          // Prevent negative price due to floating point or data inconsistency
          if (cart.totalPrice < 0) cart.totalPrice = 0;
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
      const productId = req.params._id || req.body.productId;
      const { quantity } = req.body;
      const userId = req.userId;

      const product = await Product.findById(productId);
      if (!product)
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });

      const cart = await Cart.findOne({
        userId,
        isSubscribeCart: false,
      }).populate("items.productId", "name price");
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
          cart.totalPrice += quantity * product.price;
        }

        if (cart.totalPrice < 0) cart.totalPrice = 0;
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
          totalPrice: quantity * product.price,
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
        .populate("items.productId", "name price")
        .populate("items.subscriptionPlanId", "name basePrice");

      if (cart) {
        const subscribeItem = cart.items.find(
          (item) =>
            item.subscriptionPlanId &&
            item.subscriptionPlanId._id.toString() === subscriptionPlanId,
        );

        cart.totalPrice += quantity * subscribePlan.basePrice;
        if (cart.totalPrice < 0) cart.totalPrice = 0;

        if (subscribeItem) {
          subscribeItem.quantity += quantity;
        } else {
          cart.items.push({ subscriptionPlanId, quantity });
        }
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
          totalPrice: quantity * subscribePlan.basePrice,
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
        .populate("items.productId", "name price")
        .populate("items.subscriptionPlanId", "name basePrice");
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
        .populate("items.productId", "name price")
        .populate("items.subscriptionPlanId", "name basePrice");
      if (cart) {
        const subscribeItem = cart.items.find(
          (item) =>
            item.subscriptionPlanId &&
            item.subscriptionPlanId._id.toString() === subscriptionPlanId,
        );
        if (subscribeItem) {
          cart.items.pull(subscribeItem);
          cart.totalPrice -=
            subscribeItem.quantity * subscribeItem.subscriptionPlanId.basePrice; // Assuming basePrice is the price for the subscription plan
          if (cart.totalPrice < 0) cart.totalPrice = 0;
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
        .populate("items.productId", "name price")
        .populate("items.subscriptionPlanId", "name basePrice");

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
          cart.totalPrice += quantity * subscribePlan.basePrice;
        }

        if (cart.totalPrice < 0) cart.totalPrice = 0;
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
          totalPrice: quantity * subscribePlan.basePrice,
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
