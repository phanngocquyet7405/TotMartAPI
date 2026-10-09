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
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    validationHandler.validate(createSubscriptionTemplateSchema),
    subscriptionTemplateController.createTemplate
);

// Admin: Get all templates
router.get('/all-subscription-templates',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    subscriptionTemplateController.getAllTemplates
);

// Admin: Get template by ID
router.get('/get-subscription-template/:id',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    subscriptionTemplateController.getTemplateById
);

// Admin: Update template
router.patch('/update-subscription-template/:id',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    validationHandler.validate(updateSubscriptionTemplateSchema),
    subscriptionTemplateController.updateTemplate
);

// Admin: Delete template
router.delete('/delete-subscription-template/:id',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    subscriptionTemplateController.deleteTemplate
);

// ==================== USER ROUTES (User Subscriptions) ====================

// Public: Get active templates for subscription
router.get('/get-active-subscribe',
    subscriptionTemplateController.getActiveTemplates
);

// User: Subscribe to a template
router.post('/user-subscribe',
    authMiddleware.authMiddleware,
    validationHandler.validate(subscribeToTemplateSchema),
    userSubscriptionController.subscribeToTemplate
);

// User: Get my subscriptions
router.get('/my-subscriptions',
    authMiddleware.authMiddleware,
    userSubscriptionController.getUserSubscriptions
);

// User: Get subscription details
router.get('/my-subscriptions/:id',
    authMiddleware.authMiddleware,
    userSubscriptionController.getSubscriptionById
);

// User: Cancel subscription at period end
router.patch('/my-subscriptions/:id/cancel-at-end',
    authMiddleware.authMiddleware,
    userSubscriptionController.cancelAtPeriodEnd
);

// User: Cancel subscription immediately
router.patch('/my-subscriptions/:id/cancel-immediately',
    authMiddleware.authMiddleware,
    userSubscriptionController.cancelImmediately
);

// ==================== ADMIN ROUTES (All Subscriptions - Dashboard) ====================

// Admin: Get all user subscriptions
router.get('/admin-all-subscriptions',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    userSubscriptionController.getAllSubscriptions
);

// Admin: Get subscriptions by userId
router.get('/admin-subscriptions/user/:userId',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    userSubscriptionController.getSubscriptionsByUserId
);

// ==================== UTILITIES ====================

// Trigger delivery processing
router.post('/process-deliveries',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    userSubscriptionController.triggerDeliveryProcessing
);

// ==================== CHECK TODAY DELIVERIES ====================

// Admin: Get all subscriptions that need delivery today
router.get('/today-deliveries',
    authMiddleware.authMiddleware,
    authMiddleware.adminMiddleware,
    userSubscriptionController.getTodayDeliveries
);

// User: Get my subscriptions that need delivery today
router.get('/my-today-deliveries',
    authMiddleware.authMiddleware,
    userSubscriptionController.getMyTodayDeliveries
);

const { idParamSchema, refundSchema } = require('../middleware/validationSchemas');
const joi = require('joi');
const admin = [authMiddleware.authMiddleware, authMiddleware.adminMiddleware];
router.post('/fulfillments/:_id/dispatch', ...admin, validationHandler.validate(idParamSchema, 'params'), validationHandler.validate(joi.object({ trackingReference: joi.string().trim().min(3).max(150).required() })), userSubscriptionController.dispatchFulfillment);
router.post('/fulfillments/:_id/deliver', ...admin, validationHandler.validate(idParamSchema, 'params'), userSubscriptionController.deliverFulfillment);
router.get('/pending-refunds', ...admin, userSubscriptionController.pendingRefunds);
router.post('/refunds/:_id/complete', ...admin, validationHandler.validate(idParamSchema, 'params'), validationHandler.validate(refundSchema), userSubscriptionController.completeRefund);
module.exports = router;
