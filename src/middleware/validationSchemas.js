const joi = require("joi");

const registerSchema = joi.object({
  name: joi.string().min(3).max(100).required(),
  email: joi.string().email().required(),
  password: joi.string().min(6).required(),
});

const loginSchema = joi.object({
  email: joi.string().email().required(),
  password: joi.string().min(6).required(),
});

const forgotPasswordSchema = joi.object({
  email: joi.string().email().required(),
});

const resetPasswordSchema = joi.object({
  password: joi.string().min(6).required(),
});

const updateUserSchema = joi
  .object({
    name: joi.string().min(3).max(100).optional(),
    city: joi.string().max(100).optional(),
    district: joi.string().max(100).optional(),
    address: joi.string().max(255).optional(),
    phone: joi
      .string()
      .pattern(/^[0-9()+\s-]{7,20}$/)
      .optional(),
  })
  .min(1);

const idParamSchema = joi.object({
  _id: joi.string().hex().length(24).required(),
});

// paymentCode được sinh ở checkOutController.checkOut(): "TMART" + Date.now()
// + 3 byte hex random viết hoa — pattern dưới đây khớp đúng format đó.
const paymentCodeParamSchema = joi.object({
  paymentCode: joi
    .string()
    .trim()
    .pattern(/^TMART[A-Z0-9]+$/)
    .max(50)
    .required(),
});

// Dùng cho POST /admin/orders/:_id/status — CHỈ 3 giá trị này, vì đây là
// endpoint "generic" không có side-effect (hoàn kho/hoàn coupon/hoàn tiền).
// "cancelled" đi qua checkOutController.cancelOrder, "processing" từ COD
// "pending" đi qua confirmCodOrder, "delivered" cho đơn COD đi qua
// markCodDelivered — cả 3 route đó đã có sẵn, không lặp lại ở đây. Kiểm tra
// transition CHI TIẾT (đúng trạng thái hiện tại + đúng paymentMethod) nằm ở
// orderAdminController.updateOrderStatus(), Joi chỉ chặn giá trị rác.
const orderStatusUpdateSchema = joi.object({
  status: joi.string().valid("processing", "shipped", "delivered").required(),
});

const productSchema = joi.object({
  name: joi.string().min(3).max(100).required(),
  description: joi.string().max(500).required(),
  price: joi.number().positive().required(),
  category: joi.string().max(100).required(),
  stock: joi.number().integer().min(0).required(),
  details: joi.string().max(1000).optional(),
  brand: joi.string().max(100).required(),
});

const productUpdateSchema = joi
  .object({
    name: joi.string().min(3).max(100).optional(),
    description: joi.string().max(500).optional(),
    price: joi.number().positive().optional(),
    category: joi.string().max(100).optional(),
    stock: joi.number().integer().min(0).optional(),
    details: joi.string().max(1000).optional(),
    brand: joi.string().max(100).optional(),
  })
  .min(1);

const updateAddressSchema = joi.object({
  country: joi.string().max(100).optional(),
  city: joi.string().max(100).optional(),
  district: joi.string().max(100).optional(),
  address: joi.string().max(255).optional(),
  phone: joi
    .string()
    .pattern(/^[0-9()+\s-]{7,20}$/)
    .optional(),
});

const brandSchema = joi.object({
  name: joi.string().min(3).max(100).required(),
  description: joi.string().max(500).optional(),
  cityAddress: joi.string().max(255).optional(),
  logo: joi.forbidden(),
});

const updateBrandSchema = joi
  .object({
    name: joi.string().min(3).max(100).optional(),
    description: joi.string().max(500).optional(),
    cityAddress: joi.string().max(255).optional(),
    logo: joi.forbidden(),
  })
  .min(1);

const categorySchema = joi.object({
  name: joi.string().min(3).max(100).required(),
  description: joi.string().max(500).optional(),
  childrenIds: joi.array().items(joi.string().hex().length(24)).optional(),
});

const updateCategorySchema = joi
  .object({
    name: joi.string().min(3).max(100).optional(),
    description: joi.string().max(500).optional(),
    childrenIds: joi.array().items(joi.string().hex().length(24)).optional(),
  })
  .min(1);

const createBoxSchema = joi.object({
  name: joi.string().min(3).max(100).required(),
  description: joi.string().max(500).required(),
  products: joi
    .array()
    .items(
      joi.object({
        productId: joi.string().hex().length(24).required(),
        quantity: joi.number().integer().min(1).required(),
      }),
    )
    .min(1)
    .required(),
  stock: joi.number().integer().min(0).required(),
  isGift: joi.boolean().default(false),
  discountPercent: joi.number().positive().max(100).default(0),
  validTo: joi.date().greater("now").required(),
});

const updateBoxSchema = joi
  .object({
    name: joi.string().min(3).max(100).optional(),
    description: joi.string().max(500).optional(),
    products: joi
      .array()
      .items(
        joi.object({
          productId: joi.string().hex().length(24).required(),
          quantity: joi.number().integer().min(1).required(),
        }),
      )
      .min(1)
      .optional(),
    stock: joi.number().integer().min(0).optional(),
    isGift: joi.boolean().default(false),
    discountPercent: joi.number().positive().max(100).default(0),
    validTo: joi.date().greater("now").optional(),
  })
  .min(1);

const createSubcribePlanSchema = joi.object({
  userId: joi.string().hex().length(24).required(),
  boxId: joi.string().hex().length(24).required(),
  name: joi.string().min(2).max(100).required(),
  planType: joi
    .string()
    .valid("1_month", "3_month", "6_month", "12_month")
    .required(),
  totalDeliveries: joi.number().integer().min(1).required(),
  shippingAddress: joi
    .object({
      address: joi.string().max(255).required(),
      district: joi.string().max(100).required(),
      city: joi.string().max(100).required(),
      country: joi.string().max(100).required(),
      zipCode: joi.string().max(10).required(),
      phone: joi
        .string()
        .pattern(/^[0-9()+\s-]{7,20}$/)
        .required(),
    })
    .required(),
  discountPercent: joi.number().min(0).max(100).optional(),
  gift: joi
    .array()
    .items(
      joi.object({
        boxId: joi.string().hex().length(24).required(),
        quantity: joi.number().integer().min(1).default(1).required(),
      }),
    )
    .optional()
    .default([]),
});

// Subscription Template Schema (Admin creates)
// totalDeliveries tính tự động: 1_month=1, 3_month=3, 6_month=6, 12_month=12
const createSubscriptionTemplateSchema = joi.object({
  name: joi.string().min(2).max(100).required(),
  description: joi.string().max(500).optional(),
  boxId: joi.string().hex().length(24).required(),
  planType: joi
    .string()
    .valid("1_month", "3_month", "6_month", "12_month")
    .required(),
  discountPercent: joi.number().min(0).max(100).optional(),
  gift: joi
    .array()
    .items(
      joi.object({
        boxId: joi.string().hex().length(24).required(),
        quantity: joi.number().integer().min(1).default(1).required(),
      }),
    )
    .optional()
    .default([]),
});

const updateSubscriptionTemplateSchema = joi
  .object({
    name: joi.string().min(2).max(100).optional(),
    description: joi.string().max(500).optional(),
    boxId: joi.string().hex().length(24).optional(),
    planType: joi
      .string()
      .valid("1_month", "3_month", "6_month", "12_month")
      .optional(),
    discountPercent: joi.number().min(0).max(100).optional(),
    isActive: joi.boolean().optional(),
    gift: joi
      .array()
      .items(
        joi.object({
          boxId: joi.string().hex().length(24).required(),
          quantity: joi.number().integer().min(1).default(1).required(),
        }),
      )
      .optional(),
  })
  .min(1);

// User Subscription Schema (User subscribes to template)
const subscribeToTemplateSchema = joi.object({
  templateId: joi.string().hex().length(24).required(),
  shippingAddress: joi
    .object({
      address: joi.string().max(255).required(),
      district: joi.string().max(100).required(),
      city: joi.string().max(100).required(),
      country: joi.string().max(100).required(),
      zipCode: joi.string().max(10).required(),
      phone: joi
        .string()
        .pattern(/^[0-9()+\s-]{7,20}$/)
        .required(),
    })
    .required(),
});

const checkoutSchema = joi.object({
  addressId: joi.string().hex().length(24).required(),
  paymentMethod: joi.string().valid("cod", "online").required(),
  note: joi.string().max(500).optional(),
  couponCode: joi.string().trim().uppercase().min(3).max(30).optional(),
});

const couponSchema = joi.object({
  code: joi.string().trim().uppercase().min(3).max(30).required(),
  discountType: joi.string().valid("percentage", "fixed").default("percentage"),
  discount: joi
    .number()
    .positive()
    .when("discountType", { is: "percentage", then: joi.number().max(100) })
    .required(),
  minOrderValue: joi.number().min(0).default(0),
  startDate: joi.date().required(),
  expiresAt: joi.date().greater(joi.ref("startDate")).required(),
  usageLimit: joi.number().integer().positive().allow(null).default(null),
  isActive: joi.boolean().default(true),
});

const updateCouponSchema = joi
  .object({
    discountType: joi.string().valid("percentage", "fixed"),
    discount: joi.number().positive(),
    minOrderValue: joi.number().min(0),
    startDate: joi.date(),
    expiresAt: joi.date(),
    usageLimit: joi.number().integer().positive().allow(null),
    isActive: joi.boolean(),
  })
  .min(1);

const sepayWebhookSchema = joi
  .object({
    id: joi.number().required(),
    gateway: joi.string().required(),
    transactionDate: joi.string().required(),
    accountNumber: joi.string().required(),
    code: joi.string().allow(null).optional(),
    content: joi.string().allow("").required(),
    transferType: joi.string().valid("in", "out").required(),
    transferAmount: joi.number().positive().required(),
    accumulated: joi.number().optional(),
    subAccount: joi.string().allow(null).optional(),
    referenceCode: joi.string().required(),
    description: joi.string().allow("").optional(),
  })
  .unknown(true);

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  productSchema,
  productUpdateSchema,
  updateAddressSchema,
  updateBrandSchema,
  brandSchema,
  updateUserSchema,
  idParamSchema,
  paymentCodeParamSchema,
  orderStatusUpdateSchema,
  categorySchema,
  updateCategorySchema,
  createBoxSchema,
  updateBoxSchema,
  createSubcribePlanSchema,
  createSubscriptionTemplateSchema,
  updateSubscriptionTemplateSchema,
  subscribeToTemplateSchema,
  checkoutSchema,
  sepayWebhookSchema,
  couponSchema,
  updateCouponSchema,
};
