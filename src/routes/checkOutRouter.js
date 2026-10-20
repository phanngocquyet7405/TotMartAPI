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

router.post("/quote", authMiddleware.authenticate, validationHandler.validate(quoteSchema), checkOutController.quote);
router.post("/resolve-inventory/:_id", authMiddleware.authenticate, validationHandler.validate(idParamSchema, "params"), authMiddleware.requireAdmin, checkOutController.resolveInventoryHold);
router.get("/payment-events", authMiddleware.authenticate, authMiddleware.requireAdmin, checkOutController.listPaymentEvents);

// ==== User đặt hàng (COD hoặc online) ====
router.post(
  "/check-out",
  checkoutLimiter,
  authMiddleware.authenticate,
  authMiddleware.customerCheckoutMiddleware,
  validationHandler.validate(checkoutSchema, "body"),
  checkOutController.checkOut,
);

// ==== User: polling trạng thái thanh toán ở màn QR SePay ====
router.get(
  "/order-status/:paymentCode",
  authMiddleware.authenticate,
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
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  validationHandler.validate(cancelSchema),
  checkOutController.cancelOrder,
);

// ==== Admin xác nhận đơn COD trước khi giao ====
router.post(
  "/confirm-cod/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  checkOutController.confirmCodOrder,
);

// ==== Admin/shipper xác nhận đã giao và đã thu tiền COD ====
router.post(
  "/mark-cod-delivered/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
  checkOutController.markCodDelivered,
);

// ==== Admin: danh sách đơn đang chờ hoàn tiền ====
router.get(
  "/pending-refunds",
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  checkOutController.getPendingRefunds,
);

// ==== Admin: đánh dấu đã hoàn tiền xong ====
router.post(
  "/complete-refund/:_id",
  authMiddleware.authenticate,
  validationHandler.validate(idParamSchema, "params"),
  authMiddleware.requireAdmin,
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
const { attemptIpLimiter, attemptUserLimiter } = require('../middleware/rateLimiter');
router.use('/attempts', attemptIpLimiter, authMiddleware.authenticate, attemptUserLimiter);
router.get('/attempts/:kind/:key', attemptHandler(false));
router.post('/attempts/:kind/:key/terminate', attemptHandler(true));

for (const kind of ['products', 'subscription']) {
  const schema = kind === 'products' ? checkoutSchema : require('../middleware/validationSchemas').subscribeToTemplateSchema;
  // Hash the original body using exactly the create validation/defaults. No address/template lookup.
  // This also recovers a lost prepare response or a business failure before an attempt existed.
  router.post(`/attempts/${kind}/:key/terminate-with-body`, validationHandler.validate(schema), async (req, res, next) => {
    try {
      const { key } = req.params;
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return res.status(400).json({ success: false, code: 'INVALID_ATTEMPT_REFERENCE' });
      const hash = require('../services/checkoutLifecycle').requestHash(req.validatedBody);
      const data = await require('../services/checkoutAttemptService').resolve(req.userId, kind, key, hash, true);
      res.json({ success: true, data: { key, hash, ...data } });
    } catch (err) { next(err); }
  });
  router.post(`/attempts/${kind}/prepare`, authMiddleware.customerCheckoutMiddleware,
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
