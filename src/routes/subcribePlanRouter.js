const express = require('express');
const router = express.Router();
const subscriptionTemplateController = require('../controllers/subscriptionTemplateController');
const userSubscriptionController = require('../controllers/userSubscriptionController');
const authMiddleware = require('../middleware/authMiddleware');
const validationHandler = require('../middleware/validationHandler');
const {
    createSubscriptionTemplateSchema,
    updateSubscriptionTemplateSchema,
    subscribeToTemplateSchema
} = require('../middleware/validationSchemas');

// ==================== ADMIN ROUTES (Subscription Templates) ====================

// Admin: Create subscription template
router.post('/create-subscription-template',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    validationHandler.validate(createSubscriptionTemplateSchema),
    subscriptionTemplateController.createTemplate
);

// Admin: Get all templates
router.get('/all-subscription-templates',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    subscriptionTemplateController.getAllTemplates
);

// Admin: Get template by ID
router.get('/get-subscription-template/:id',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    subscriptionTemplateController.getTemplateById
);

// Admin: Update template
router.patch('/update-subscription-template/:id',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    validationHandler.validate(updateSubscriptionTemplateSchema),
    subscriptionTemplateController.updateTemplate
);

// Admin: Delete template
router.delete('/delete-subscription-template/:id',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    subscriptionTemplateController.deleteTemplate
);

// ==================== USER ROUTES (User Subscriptions) ====================

// Public: Get active templates for subscription
router.get('/get-active-subscribe',
    subscriptionTemplateController.getActiveTemplates
);

// User: Subscribe to a template
router.post('/user-subscribe',
    authMiddleware.authenticate,
    authMiddleware.customerCheckoutMiddleware,
    validationHandler.validate(subscribeToTemplateSchema),
    userSubscriptionController.subscribeToTemplate
);

// User: Get my subscriptions
router.get('/my-subscriptions',
    authMiddleware.authenticate,
    userSubscriptionController.getUserSubscriptions
);

// User: Get subscription details
router.get('/my-subscriptions/:id',
    authMiddleware.authenticate,
    userSubscriptionController.getSubscriptionById
);

// User: Cancel subscription at period end
router.patch('/my-subscriptions/:id/cancel-at-end',
    authMiddleware.authenticate,
    userSubscriptionController.cancelAtPeriodEnd
);

// User: Cancel subscription immediately
router.patch('/my-subscriptions/:id/cancel-immediately',
    authMiddleware.authenticate,
    userSubscriptionController.cancelImmediately
);

// ==================== ADMIN ROUTES (All Subscriptions - Dashboard) ====================

// Admin: Get all user subscriptions
router.get('/admin-all-subscriptions',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    userSubscriptionController.getAllSubscriptions
);

// Admin: Get subscriptions by userId
router.get('/admin-subscriptions/user/:userId',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    userSubscriptionController.getSubscriptionsByUserId
);

// ==================== UTILITIES ====================

// Trigger delivery processing
router.post('/process-deliveries',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    userSubscriptionController.triggerDeliveryProcessing
);

// ==================== CHECK TODAY DELIVERIES ====================

// Admin: Get all subscriptions that need delivery today
router.get('/today-deliveries',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    userSubscriptionController.getTodayDeliveries
);

// User: Get my subscriptions that need delivery today
router.get('/my-today-deliveries',
    authMiddleware.authenticate,
    userSubscriptionController.getMyTodayDeliveries
);

const { idParamSchema, refundSchema } = require('../middleware/validationSchemas');
const joi = require('joi');
const admin = [authMiddleware.authenticate, authMiddleware.requireAdmin];
router.post('/fulfillments/:_id/dispatch', authMiddleware.authenticate, validationHandler.validate(idParamSchema, 'params'), authMiddleware.requireAdmin, validationHandler.validate(joi.object({ trackingReference: joi.string().trim().min(3).max(150).required() })), userSubscriptionController.dispatchFulfillment);
router.post('/fulfillments/:_id/deliver', authMiddleware.authenticate, validationHandler.validate(idParamSchema, 'params'), authMiddleware.requireAdmin, userSubscriptionController.deliverFulfillment);
router.get('/pending-refunds', ...admin, userSubscriptionController.pendingRefunds);
router.post('/refunds/:_id/complete', authMiddleware.authenticate, validationHandler.validate(idParamSchema, 'params'), authMiddleware.requireAdmin, validationHandler.validate(refundSchema), userSubscriptionController.completeRefund);
module.exports = router;
