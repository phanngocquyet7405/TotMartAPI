const express = require("express");
const router = express.Router();
const checkOutController = require("../controllers/checkOutController");
const authMiddleware = require("../middleware/authMiddleware");
const sepayAuth = require("../middleware/sepayAuth");
const validationHandler = require("../middleware/validationHandler");
const { quoteSchema, refundSchema, cancelSchema } = require("../middleware/validationSchemas");
const {
  checkoutLimiter,
  webhookLimiter,
} = require("../middleware/rateLimiter");
const {
  checkoutSchema,
  sepayWebhookSchema,
  idParamSchema,
  paymentCodeParamSchema,
} = require("../middleware/validationSchemas");

router.post("/quote", authMiddleware.authMiddleware, validationHandler.validate(quoteSchema), checkOutController.quote);
router.post("/resolve-inventory/:_id", authMiddleware.authMiddleware, authMiddleware.adminMiddleware, validationHandler.validate(idParamSchema, "params"), checkOutController.resolveInventoryHold);
router.get("/payment-events", authMiddleware.authMiddleware, authMiddleware.adminMiddleware, checkOutController.listPaymentEvents);

// ==== User đặt hàng (COD hoặc online) ====
router.post(
  "/check-out",
  checkoutLimiter,
  authMiddleware.authMiddleware,
  authMiddleware.customerCheckoutMiddleware,
  validationHandler.validate(checkoutSchema, "body"),
  checkOutController.checkOut,
);

// ==== User: polling trạng thái thanh toán ở màn QR SePay ====
router.get(
  "/order-status/:paymentCode",
  authMiddleware.authMiddleware,
  validationHandler.validate(paymentCodeParamSchema, "params"),
  checkOutController.getOrderStatus,
);

router.post(
  "/sepay-webhook",
  webhookLimiter,
  sepayAuth.verifyApiKey,
  validationHandler.validate(sepayWebhookSchema, "body"),
  checkOutController.sepayWebhook,
);

// ==== User huỷ đơn của mình / admin huỷ bất kỳ đơn nào (check quyền trong controller) ====
router.post(
  "/cancel/:_id",
  authMiddleware.authMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  validationHandler.validate(cancelSchema),
  checkOutController.cancelOrder,
);

// ==== Admin xác nhận đơn COD trước khi giao ====
router.post(
  "/confirm-cod/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  checkOutController.confirmCodOrder,
);

// ==== Admin/shipper xác nhận đã giao và đã thu tiền COD ====
router.post(
  "/mark-cod-delivered/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  checkOutController.markCodDelivered,
);

// ==== Admin: danh sách đơn đang chờ hoàn tiền ====
router.get(
  "/pending-refunds",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  checkOutController.getPendingRefunds,
);

// ==== Admin: đánh dấu đã hoàn tiền xong ====
router.post(
  "/complete-refund/:_id",
  authMiddleware.authMiddleware,
  authMiddleware.adminMiddleware,
  validationHandler.validate(idParamSchema, "params"),
  validationHandler.validate(refundSchema),
  checkOutController.completeRefund,
);

module.exports = router;

const attemptHandler = terminate => async (req, res, next) => {
  try {
    const { kind, key } = req.params;
    const hash = req.get('Attempt-Payload-Hash');
    if (!['products', 'subscription'].includes(kind) || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || !/^[a-f0-9]{64}$/.test(hash || ''))
      return res.status(400).json({ success: false, code: 'INVALID_ATTEMPT_REFERENCE' });
    const data = await require('../services/checkoutAttemptService').resolve(req.userId, kind, key, hash, terminate);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};
router.get('/attempts/:kind/:key', authMiddleware.authMiddleware, attemptHandler(false));
router.post('/attempts/:kind/:key/terminate', authMiddleware.authMiddleware, attemptHandler(true));

for (const kind of ['products', 'subscription']) {
  const schema = kind === 'products' ? checkoutSchema : require('../middleware/validationSchemas').subscribeToTemplateSchema;
  router.post(`/attempts/${kind}/prepare`, authMiddleware.authMiddleware, authMiddleware.customerCheckoutMiddleware,
    validationHandler.validate(schema), async (req, res, next) => {
      try {
        const key = require('../utils/idempotencyKey')(req);
        const hash = require('../services/checkoutLifecycle').requestHash(req.validatedBody);
        const legacy = await require('../services/checkoutLifecycle').replay(req.userId, key, hash, null, kind);
        const attempt = legacy || await require('../services/checkoutAttemptService').prepare(req.userId, kind, key, hash, req.validatedBody);
        res.json({ success: true, data: { key, hash, state: legacy ? 'created' : attempt.state,
          address: attempt.address, addressHash: attempt.address ? require('../services/checkoutLifecycle').requestHash(attempt.address) : undefined,
          result: attempt.result } });
      } catch (err) { next(err); }
    });
}
