# B02 — inventory route tại lần khép

Nguồn: đọc tĩnh 17 file route hiện tại, mount ngoài đối chiếu src/routes/index.js; không phải kết quả HTTP hay chứng nhận mọi endpoint đã được test. 146 đăng ký method/path, gồm route public trong module bị đổi và các alias. Chuỗi giữ thứ tự thực thi; inline@N là callback tại dòng N. Global middleware src/app.js (request ID, helmet, body parser/sanitize, CORS, cookie parser/CSRF) chạy trước các mount; 404 và error handler chạy sau. GET có HEAD fallback Express; OPTIONS tự động không trả payload nghiệp vụ.

Alias đã liệt kê riêng: GET categories/get-root-category và get-root-categories, GET manager/gifts so với combos?kind=gift, POST/PATCH manager/orders/:id/status, hai kind products/subscription của attempt prepare/terminate-with-body; shippingMode và DTO aliases là dữ liệu, không phải route mới. Trailing slash/case mặc định Express không tạo thêm policy.

Phân loại đọc source: admin guard ở endpoint admin; requireMerchant ở tất cả endpoint manager. Public catalog/health/login/register/forgot/reset không yêu cầu JWT; refresh xác minh refresh token ở controller; SePay webhook dùng verifyApiKey; notification stream dùng ticket một lần ở controller. Các route authenticated không có role guard dùng ownership/policy trong controller/service (cart, order khách, subscription khách, cancel, attempt), không tự thêm admin override. AuthSession chỉ query nếu JWT có sid; production bắt buộc sid, legacy test/non-production không sid không có query session.

## src/routes/adminCommerceRouter.js

Mount ngoài: `/api/admin`.

- Mount nội bộ `/gifts | /merchants` (dòng 13): `auth.authenticate`.

- **POST `/api/admin/merchants/:merchantId/brands`** (dòng 14); mount: `auth.authenticate`; route: `validate.validate(Joi.object({ merchantId: Joi.string().hex().length(24).required() }), 'params')` → `auth.requireAdmin` → `validate.validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() }))` → `inline@18`; guard: `auth.requireAdmin`.
- **GET `/api/admin/gifts`** (dòng 24); mount: `auth.authenticate`; route: `auth.requireAdmin` → `inline@24`; guard: `auth.requireAdmin`.
- **POST `/api/admin/gifts`** (dòng 30); mount: `auth.authenticate`; route: `auth.requireAdmin` → `validate.validate(schema.createGift)` → `inline@30`; guard: `auth.requireAdmin`.
- **PATCH `/api/admin/gifts/:id`** (dòng 35); mount: `auth.authenticate`; route: `validate.validate(schema.idParams, 'params')` → `auth.requireAdmin` → `validate.validate(schema.updateGift)` → `inline@35`; guard: `auth.requireAdmin`.
- **DELETE `/api/admin/gifts/:id`** (dòng 44); mount: `auth.authenticate`; route: `validate.validate(schema.idParams, 'params')` → `auth.requireAdmin` → `inline@44`; guard: `auth.requireAdmin`.

## src/routes/boxRouter.js

Mount ngoài: `/api/boxes`.


- **POST `/api/boxes/create-box`** (dòng 11); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `upload.boxUpload.array("images", 10)` → `validateHandler.validate(validationSchemas.createBoxSchema)` → `boxController.createBox`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/boxes/get-all-box`** (dòng 20); mount: không có auth mount; route: `boxController.getAllBoxes`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/boxes/public/:_id`** (dòng 21); mount: không có auth mount; route: `validateHandler.validate(validationSchemas.idParamSchema, "params")` → `boxController.getPublicBox`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/boxes/get-box-by-id/:_id`** (dòng 23); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `boxController.getBoxById`; guard: `authMiddleware.requireAdmin`.
- **PUT `/api/boxes/update-box/:_id`** (dòng 30); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `upload.boxUpload.array("images", 10)` → `validateHandler.validate(validationSchemas.updateBoxSchema)` → `boxController.updateBox`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/boxes/adjust-stock/:_id`** (dòng 39); mount: không có auth mount; route: `authMiddleware.authenticate` → `validateHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `validateHandler.validate(validationSchemas.adjustStockSchema)` → `boxController.adjustStock`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/boxes/delete-box/:_id`** (dòng 48); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `boxController.deleteBox`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/boxes/get-products-in-box/:_id`** (dòng 55); mount: không có auth mount; route: `boxController.getProductsInBox`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/boxes/get-box-offer-discount-coupons`** (dòng 57); mount: không có auth mount; route: `boxController.getBoxOfferDicountCoupons`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/brandRouter.js

Mount ngoài: `/api/brands`.


- **POST `/api/brands/create-brand`** (dòng 9); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `brandLogoUpload` → `validationHandler.validate(validationSchemas.brandSchema)` → `brandController.createBrand`; guard: `authMiddleware.requireAdmin`.
- **PUT `/api/brands/update-brand/:_id`** (dòng 17); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `brandLogoUpload` → `inline@24` → `brandController.updateBrand`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/brands/delete-brand/:_id`** (dòng 32); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `brandController.deleteBrand`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/brands/merchant-options`** (dòng 40); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `inline@40`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/brands/manage/:_id`** (dòng 44); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `brandController.getManagedBrand`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/brands/get-all-brands`** (dòng 47); mount: không có auth mount; route: `brandController.getAllBrands`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/cartRouter.js

Mount ngoài: `/api/carts`.


- **GET `/api/carts/get-cart/:_id`** (dòng 12); mount: không có auth mount; route: `authMiddleware.authenticate` → `cartController.getCartByUser`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/carts/get-all-cart`** (dòng 17); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `cartController.getAllCart`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/carts/add-to-cart`** (dòng 23); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(addToCartSchema, "body")` → `cartController.addToCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PUT `/api/carts/sync`** (dòng 30); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(syncCartSchema, "body")` → `cartController.syncCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PUT `/api/carts/update-cart/:_id`** (dòng 36); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(updateCartSchema, "body")` → `cartController.updateCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **DELETE `/api/carts/delete-from-cart/:_id`** (dòng 42); mount: không có auth mount; route: `authMiddleware.authenticate` → `cartController.deleteFromCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/carts/add-subscribe-plan-to-cart`** (dòng 48); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(require("../middleware/validationSchemas").subscriptionCartSchema)` → `cartController.addSubscribeCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PUT `/api/carts/update-subscribe-cart`** (dòng 54); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(require("../middleware/validationSchemas").subscriptionCartSchema)` → `cartController.updateSubscribeCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **DELETE `/api/carts/delete-from-subscribe-cart/:_id`** (dòng 60); mount: không có auth mount; route: `authMiddleware.authenticate` → `cartController.deleteFromSubscribeCart`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/carts/get-subscribe-cart/:_id`** (dòng 66); mount: không có auth mount; route: `authMiddleware.authenticate` → `cartController.getSubscribeCartByUser`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/categoryRouter.js

Mount ngoài: `/api/categories`.


- **POST `/api/categories/create-category`** (dòng 9); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `validationHandler.validate(validationSchemas.categorySchema)` → `categoryController.createCategory`; guard: `authMiddleware.requireAdmin`.
- **PUT `/api/categories/update-category/:_id`** (dòng 15); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `validationHandler.validate(validationSchemas.updateCategorySchema)` → `categoryController.updateCategory`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/categories/delete-category/:_id`** (dòng 22); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `categoryController.deleteCategory`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/categories/get-all-categories`** (dòng 28); mount: không có auth mount; route: `categoryController.getAllCategories`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/categories/get-root-categories`** (dòng 31); mount: không có auth mount; route: `categoryController.getRootCategory`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/categories/get-category-by-id/:_id`** (dòng 34); mount: không có auth mount; route: `validationHandler.validate(validationSchemas.idParamSchema, 'params')` → `categoryController.getCategoryById`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/categories/get-products-by-category/:_id`** (dòng 39); mount: không có auth mount; route: `validationHandler.validate(validationSchemas.idParamSchema, 'params')` → `categoryController.getProductsByCategory`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/categories/get-root-category`** (dòng 44); mount: không có auth mount; route: `categoryController.getRootCategory`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/checkOutRouter.js

Mount ngoài: `/api/checkout`.

- Mount nội bộ `/attempts` (dòng 107): `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`.

- **POST `/api/checkout/quote`** (dòng 19); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(quoteSchema)` → `checkOutController.quote`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/resolve-inventory/:_id`** (dòng 20); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `checkOutController.resolveInventoryHold`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/checkout/payment-events`** (dòng 21); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `checkOutController.listPaymentEvents`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/checkout/check-out`** (dòng 24); mount: không có auth mount; route: `checkoutLimiter` → `authMiddleware.authenticate` → `authMiddleware.customerCheckoutMiddleware` → `validationHandler.validate(checkoutSchema, "body")` → `checkOutController.checkOut`; guard: `authMiddleware.customerCheckoutMiddleware`.
- **GET `/api/checkout/order-status/:paymentCode`** (dòng 34); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(paymentCodeParamSchema, "params")` → `checkOutController.getOrderStatus`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/sepay-webhook`** (dòng 41); mount: không có auth mount; route: `webhookLimiter` → `sepayAuth.verifyApiKey` → `validationHandler.validate(sepayWebhookSchema, "body")` → `checkOutController.sepayWebhook`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/cancel/:_id`** (dòng 50); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `validationHandler.validate(cancelSchema)` → `checkOutController.cancelOrder`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/confirm-cod/:_id`** (dòng 59); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `checkOutController.confirmCodOrder`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/checkout/mark-cod-delivered/:_id`** (dòng 68); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `checkOutController.markCodDelivered`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/checkout/pending-refunds`** (dòng 77); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `checkOutController.getPendingRefunds`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/checkout/complete-refund/:_id`** (dòng 85); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `validationHandler.validate(refundSchema)` → `checkOutController.completeRefund`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/checkout/attempts/:kind/:key`** (dòng 108); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `attemptHandler(false)`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/attempts/:kind/:key/terminate`** (dòng 109); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `attemptHandler(true)`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/attempts/products/:key/terminate-with-body`** (dòng 115); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `validationHandler.validate(schema)` → `inline@115`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/attempts/products/prepare`** (dòng 124); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `authMiddleware.customerCheckoutMiddleware` → `validationHandler.validate(schema)` → `inline@125`; guard: `authMiddleware.customerCheckoutMiddleware`.
- **POST `/api/checkout/attempts/subscription/:key/terminate-with-body`** (dòng 115); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `validationHandler.validate(schema)` → `inline@115`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/checkout/attempts/subscription/prepare`** (dòng 124); mount: `attemptIpLimiter` → `authMiddleware.authenticate` → `attemptUserLimiter`; route: `authMiddleware.customerCheckoutMiddleware` → `validationHandler.validate(schema)` → `inline@125`; guard: `authMiddleware.customerCheckoutMiddleware`.

## src/routes/couponRouter.js

Mount ngoài: `/api/coupons`.


- **POST `/api/coupons/create-coupon`** (dòng 12); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `validationHandler.validate(couponSchema, "body")` → `couponController.createCoupon`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/coupons/get-all-coupons`** (dòng 20); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `couponController.getAllCoupons`; guard: `authMiddleware.requireAdmin`.
- **PUT `/api/coupons/update-coupon/:_id`** (dòng 27); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `validationHandler.validate(updateCouponSchema, "body")` → `couponController.updateCoupon`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/coupons/delete-coupon/:_id`** (dòng 36); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `couponController.deleteCoupon`; guard: `authMiddleware.requireAdmin`.

## src/routes/customerOrderRouter.js

Mount ngoài: `/api/orders`.

- Mount nội bộ `/` (dòng 7): `authenticate`.

- **POST `/api/orders/:_id/confirm-receipt`** (dòng 8); mount: `authenticate`; route: `validation.validate(idParamSchema, 'params')` → `controller.confirmReceipt`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/orders`** (dòng 9); mount: `authenticate`; route: `controller.list`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/orders/:_id`** (dòng 10); mount: `authenticate`; route: `validation.validate(idParamSchema, "params")` → `controller.detail`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/homeRouter.js

Mount ngoài: `/api/home`.


- **GET `/api/home/health`** (dòng 10); mount: không có auth mount; route: `require('../controllers/healthController').readiness`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/home/live`** (dòng 11); mount: không có auth mount; route: `require('../controllers/healthController').liveness`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/home/login`** (dòng 13); mount: không có auth mount; route: `authLimiter` → `validationHandler.validate(validationSchemas.loginSchema)` → `authController.login`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/home/refresh`** (dòng 19); mount: không có auth mount; route: `refreshLimiter` → `authController.refresh`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/home/logout`** (dòng 20); mount: không có auth mount; route: `auth.authenticate` → `authController.logout`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/home/forgot-password`** (dòng 21); mount: không có auth mount; route: `authLimiter` → `validationHandler.validate(validationSchemas.forgotPasswordSchema)` → `authController.forgotPassword`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/home/reset-password`** (dòng 27); mount: không có auth mount; route: `authLimiter` → `validationHandler.validate(validationSchemas.resetPasswordSchema)` → `authController.resetPassword`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/managerRouter.js

Mount ngoài: `/api/manager`.

- Mount nội bộ `/` (dòng 10): `auth.authenticate` → `inline@10`.

- **GET `/api/manager/catalog-options`** (dòng 40); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `controller.options`; guard: `auth.requireMerchant`.
- **POST `/api/manager/brands`** (dòng 41); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `validate(Joi.object({ name: Joi.string().trim().min(3).max(100).required() }))` → `controller.createBrand`; guard: `auth.requireMerchant`.
- **GET `/api/manager/products`** (dòng 42); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `controller.products`; guard: `auth.requireMerchant`.
- **POST `/api/manager/products`** (dòng 43); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `upload.array('images', 10)` → `validate(schemas.createProduct)` → `ownReferences` → `product.createProduct`; guard: `auth.requireMerchant`.
- **PUT `/api/manager/products/:id`** (dòng 44); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `ownProduct` → `upload.array('images', 10)` → `inline@45` → `ownReferences` → `product.updateProduct`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/products/:id/stock`** (dòng 46); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.stock)` → `controller.productStock`; guard: `auth.requireMerchant`.
- **DELETE `/api/manager/products/:id`** (dòng 47); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `ownProduct` → `product.deleteProduct`; guard: `auth.requireMerchant`.
- **GET `/api/manager/combos`** (dòng 48); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `controller.combos`; guard: `auth.requireMerchant`.
- **POST `/api/manager/combos`** (dòng 49); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `upload.array('images', 10)` → `parseMultipart` → `validate(schemas.createCombo)` → `controller.createCombo`; guard: `auth.requireMerchant`.
- **PUT `/api/manager/combos/:id`** (dòng 50); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `upload.array('images', 10)` → `parseMultipart` → `inline@51` → `controller.updateCombo`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/combos/:id/stock`** (dòng 52); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.stock)` → `controller.boxStock`; guard: `auth.requireMerchant`.
- **DELETE `/api/manager/combos/:id`** (dòng 53); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `controller.deleteBox`; guard: `auth.requireMerchant`.
- **GET `/api/manager/gifts`** (dòng 54); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `inline@54` → `controller.combos`; guard: `auth.requireMerchant`.
- **POST `/api/manager/gifts`** (dòng 55); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `validate(schemas.createGift)` → `controller.createGift`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/gifts/:id`** (dòng 56); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.updateGift)` → `controller.updateGift`; guard: `auth.requireMerchant`.
- **GET `/api/manager/subscriptions`** (dòng 57); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `controller.subscriptions`; guard: `auth.requireMerchant`.
- **POST `/api/manager/subscriptions`** (dòng 58); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `validate(schemas.createSubscription)` → `controller.createSubscription`; guard: `auth.requireMerchant`.
- **POST `/api/manager/retail-subscriptions`** (dòng 59); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `validate(schemas.createRetail)` → `controller.createRetail`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/retail-subscriptions/:id/stock`** (dòng 60); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.stock)` → `controller.retailStock`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/subscriptions/:id`** (dòng 61); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.updateSubscription)` → `controller.updateSubscription`; guard: `auth.requireMerchant`.
- **DELETE `/api/manager/subscriptions/:id`** (dòng 62); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `controller.deleteSubscription`; guard: `auth.requireMerchant`.
- **GET `/api/manager/orders`** (dòng 63); mount: `auth.authenticate` → `inline@10`; route: `auth.requireMerchant` → `controller.orders`; guard: `auth.requireMerchant`.
- **GET `/api/manager/orders/:id`** (dòng 64); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `controller.orderDetail`; guard: `auth.requireMerchant`.
- **PATCH `/api/manager/orders/:id/status`** (dòng 65); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.orderStatus)` → `controller.orderStatus`; guard: `auth.requireMerchant`.
- **POST `/api/manager/orders/:id/status`** (dòng 66); mount: `auth.authenticate` → `inline@10`; route: `id = validate(schemas.idParams, 'params')` → `auth.requireMerchant` → `validate(schemas.orderStatus)` → `controller.orderStatus`; guard: `auth.requireMerchant`.

## src/routes/notificationRouter.js

Mount ngoài: `/api/admin/notifications`.


- **GET `/api/admin/notifications/stream-ticket`** (dòng 8); mount: không có auth mount; route: `require("../middleware/rateLimiter").ticketLimiter` → `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `notificationController.issueStreamTicket`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/admin/notifications/stream`** (dòng 16); mount: không có auth mount; route: `notificationController.streamNotifications`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/admin/notifications`** (dòng 18); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `notificationController.getNotifications`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/admin/notifications/mark-all-read`** (dòng 25); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `notificationController.markAllAsRead`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/admin/notifications/:_id/mark-read`** (dòng 32); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `notificationController.markAsRead`; guard: `authMiddleware.requireAdmin`.

## src/routes/orderRouter.js

Mount ngoài: `/api/admin/orders`.


- **GET `/api/admin/orders`** (dòng 14); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `orderAdminController.getAllOrders`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/admin/orders/:_id`** (dòng 22); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `orderAdminController.getOrderById`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/admin/orders/:_id/status`** (dòng 33); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, "params")` → `authMiddleware.requireAdmin` → `validationHandler.validate(orderStatusUpdateSchema, "body")` → `orderAdminController.updateOrderStatus`; guard: `authMiddleware.requireAdmin`.

## src/routes/productRouter.js

Mount ngoài: `/api/products`.


- **POST `/api/products/create-product/`** (dòng 11); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `upload.array("images", 10)` → `validationHandler.validate(validationSchemas.productSchema)` → `productController.createProduct`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/products/get-all-products/`** (dòng 20); mount: không có auth mount; route: `productController.getAllProducts`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PUT `/api/products/update-product/:_id`** (dòng 22); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `upload.array("images", 10)` → `inline@28` → `productController.updateProduct`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/products/adjust-stock/:_id`** (dòng 32); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `validationHandler.validate(validationSchemas.adjustStockSchema)` → `productController.adjustStock`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/products/delete-product/:_id`** (dòng 41); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `productController.deleteProduct`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/products/get-products-by-id/:_id`** (dòng 49); mount: không có auth mount; route: `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `productController.getProductById`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/reconciliationRouter.js

Mount ngoài: `/api/admin/reconciliation`.

- Mount nội bộ `/` (dòng 10): `auth.authenticate`.

- **POST `/api/admin/reconciliation/allocate`** (dòng 16); mount: `auth.authenticate`; route: `auth.requireAdmin` → `validate.validate(schemas.allocateSchema)` → `inline@16`; guard: `auth.requireAdmin`.
- **POST `/api/admin/reconciliation/refund-receipt`** (dòng 20); mount: `auth.authenticate`; route: `auth.requireAdmin` → `validate.validate(schemas.refundReceiptSchema)` → `inline@20`; guard: `auth.requireAdmin`.
- **GET `/api/admin/reconciliation/refunds`** (dòng 24); mount: `auth.authenticate`; route: `auth.requireAdmin` → `inline@24`; guard: `auth.requireAdmin`.
- **POST `/api/admin/reconciliation/refunds/:_id/complete`** (dòng 32); mount: `auth.authenticate`; route: `validate.validate(schemas.idSchema, 'params')` → `auth.requireAdmin` → `validate.validate(schemas.completeSchema)` → `inline@33`; guard: `auth.requireAdmin`.
- **GET `/api/admin/reconciliation/audit`** (dòng 37); mount: `auth.authenticate`; route: `auth.requireAdmin` → `inline@37`; guard: `auth.requireAdmin`.

## src/routes/subcribePlanRouter.js

Mount ngoài: `/api/subcribe-plans`.


- **POST `/api/subcribe-plans/create-subscription-template`** (dòng 16); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `validationHandler.validate(createSubscriptionTemplateSchema)` → `subscriptionTemplateController.createTemplate`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/all-subscription-templates`** (dòng 24); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `subscriptionTemplateController.getAllTemplates`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/get-subscription-template/:id`** (dòng 31); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `subscriptionTemplateController.getTemplateById`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/subcribe-plans/update-subscription-template/:id`** (dòng 38); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `validationHandler.validate(updateSubscriptionTemplateSchema)` → `subscriptionTemplateController.updateTemplate`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/subcribe-plans/delete-subscription-template/:id`** (dòng 46); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `subscriptionTemplateController.deleteTemplate`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/get-active-subscribe`** (dòng 55); mount: không có auth mount; route: `subscriptionTemplateController.getActiveTemplates`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/subcribe-plans/user-subscribe`** (dòng 60); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.customerCheckoutMiddleware` → `validationHandler.validate(subscribeToTemplateSchema)` → `userSubscriptionController.subscribeToTemplate`; guard: `authMiddleware.customerCheckoutMiddleware`.
- **GET `/api/subcribe-plans/my-subscriptions`** (dòng 68); mount: không có auth mount; route: `authMiddleware.authenticate` → `userSubscriptionController.getUserSubscriptions`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/subcribe-plans/my-subscriptions/:id`** (dòng 74); mount: không có auth mount; route: `authMiddleware.authenticate` → `userSubscriptionController.getSubscriptionById`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PATCH `/api/subcribe-plans/my-subscriptions/:id/cancel-at-end`** (dòng 80); mount: không có auth mount; route: `authMiddleware.authenticate` → `userSubscriptionController.cancelAtPeriodEnd`; guard: không có role guard; xem phân loại đầu tài liệu.
- **PATCH `/api/subcribe-plans/my-subscriptions/:id/cancel-immediately`** (dòng 86); mount: không có auth mount; route: `authMiddleware.authenticate` → `userSubscriptionController.cancelImmediately`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/subcribe-plans/admin-all-subscriptions`** (dòng 94); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `userSubscriptionController.getAllSubscriptions`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/admin-subscriptions/user/:userId`** (dòng 101); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `userSubscriptionController.getSubscriptionsByUserId`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/subcribe-plans/process-deliveries`** (dòng 110); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `userSubscriptionController.triggerDeliveryProcessing`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/today-deliveries`** (dòng 119); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `userSubscriptionController.getTodayDeliveries`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/my-today-deliveries`** (dòng 126); mount: không có auth mount; route: `authMiddleware.authenticate` → `userSubscriptionController.getMyTodayDeliveries`; guard: không có role guard; xem phân loại đầu tài liệu.
- **POST `/api/subcribe-plans/fulfillments/:_id/dispatch`** (dòng 134); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `validationHandler.validate(joi.object({ trackingReference: joi.string().trim().min(3).max(150).required() }))` → `userSubscriptionController.dispatchFulfillment`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/subcribe-plans/fulfillments/:_id/deliver`** (dòng 135); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `userSubscriptionController.deliverFulfillment`; guard: `authMiddleware.requireAdmin`.
- **GET `/api/subcribe-plans/pending-refunds`** (dòng 136); mount: không có auth mount; route: `authMiddleware.authenticate` → `authMiddleware.requireAdmin` → `userSubscriptionController.pendingRefunds`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/subcribe-plans/refunds/:_id/complete`** (dòng 137); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(idParamSchema, 'params')` → `authMiddleware.requireAdmin` → `validationHandler.validate(refundSchema)` → `userSubscriptionController.completeRefund`; guard: `authMiddleware.requireAdmin`.

## src/routes/userRouter.js

Mount ngoài: `/api/users`.


- **POST `/api/users/register`** (dòng 10); mount: không có auth mount; route: `authLimiter` → `validationHandler.validate(validationSchemas.registerSchema)` → `userController.createUser`; guard: không có role guard; xem phân loại đầu tài liệu.
- **GET `/api/users/get-all-users`** (dòng 16); mount: không có auth mount; route: `authMiddleware.adminMiddleware` → `userController.getAllUsers`; guard: `authMiddleware.adminMiddleware`.
- **GET `/api/users/get-user-by-id/:_id`** (dòng 21); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireOwnerOrAdmin` → `userController.getUserById`; guard: `authMiddleware.requireOwnerOrAdmin`.
- **PUT `/api/users/update-user/:_id`** (dòng 28); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireOwnerOrAdmin` → `validationHandler.validate(validationSchemas.updateUserSchema)` → `userController.updateUser`; guard: `authMiddleware.requireOwnerOrAdmin`.
- **DELETE `/api/users/lock-user/:_id`** (dòng 36); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `userController.lockUser`; guard: `authMiddleware.requireAdmin`.
- **PATCH `/api/users/unlock-user/:_id`** (dòng 43); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `userController.unlockUser`; guard: `authMiddleware.requireAdmin`.
- **DELETE `/api/users/delete-user/:_id`** (dòng 50); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireAdmin` → `userController.deleteUser`; guard: `authMiddleware.requireAdmin`.
- **POST `/api/users/update-address/:_id`** (dòng 57); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireOwnerOrAdmin` → `validationHandler.validate(validationSchemas.updateAddressSchema)` → `userController.updateAddress`; guard: `authMiddleware.requireOwnerOrAdmin`.
- **PUT `/api/users/edit-address/:_id/:address_id`** (dòng 66); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireOwnerOrAdmin` → `validationHandler.validate(validationSchemas.updateAddressSchema)` → `userController.editAddress`; guard: `authMiddleware.requireOwnerOrAdmin`.
- **DELETE `/api/users/delete-address/:_id/:address_id`** (dòng 75); mount: không có auth mount; route: `authMiddleware.authenticate` → `validationHandler.validate(validationSchemas.idParamSchema, "params")` → `authMiddleware.requireOwnerOrAdmin` → `userController.deleteAddress`; guard: `authMiddleware.requireOwnerOrAdmin`.
- **GET `/api/users/me`** (dòng 83); mount: không có auth mount; route: `authMiddleware.authenticate` → `userController.getMyProfile`; guard: không có role guard; xem phân loại đầu tài liệu.

## src/routes/index.js

Mount ngoài: `(app trực tiếp)`.


- **GET `/api/admin/operations/health-summary`** (dòng 15); mount: không có auth mount; route: `require('../middleware/authMiddleware').authenticate` → `require('../middleware/authMiddleware').requireAdmin` → `require('../controllers/operationsController').summary`; guard: `require('../middleware/authMiddleware').requireAdmin`.
- **GET `/api/commerce-policy`** (dòng 25); mount: không có auth mount; route: `inline@25`; guard: không có role guard; xem phân loại đầu tài liệu.

