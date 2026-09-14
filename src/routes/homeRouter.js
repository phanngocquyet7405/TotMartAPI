const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');
const validationHandler = require('../middleware/validationHandler');
const validationSchemas = require('../middleware/validationSchemas');
const { authLimiter } = require('../middleware/rateLimiter');

router.get('/health', (req, res) => {
    res.send('API is healthy');
});

router.post('/login', authLimiter, validationHandler.validate(validationSchemas.loginSchema), authController.login);
router.post('/logout', auth.authMiddleware, authController.logout);
router.post('/forgot-password',
    authLimiter,
    validationHandler.validate(validationSchemas.forgotPasswordSchema),
    authController.forgotPassword
);
router.post('/reset-password',
    authLimiter,
    validationHandler.validate(validationSchemas.resetPasswordSchema),
    authController.resetPassword
);

module.exports = router;