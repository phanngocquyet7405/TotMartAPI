const experss = require("express");
const router = experss.Router();

const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/authMiddleware');
const validationHandler = require('../middleware/validationHandler');
const validationSchemas = require('../middleware/validationSchemas');

router.post('/create-category',
    authMiddleware.authenticate,
    authMiddleware.requireAdmin,
    validationHandler.validate(validationSchemas.categorySchema),
    categoryController.createCategory
);
router.put('/update-category/:_id',
    authMiddleware.authenticate,
    validationHandler.validate(validationSchemas.idParamSchema, 'params'),
    authMiddleware.requireAdmin,
    validationHandler.validate(validationSchemas.updateCategorySchema),
    categoryController.updateCategory
);
router.delete('/delete-category/:_id',
    authMiddleware.authenticate,
    validationHandler.validate(validationSchemas.idParamSchema, 'params'),
    authMiddleware.requireAdmin,
    categoryController.deleteCategory
);
router.get('/get-all-categories',
    categoryController.getAllCategories
);
router.get('/get-root-categories',
    categoryController.getRootCategory
);
router.get('/get-category-by-id/:_id',
    validationHandler.validate(validationSchemas.idParamSchema, 'params'),
    categoryController.getCategoryById
);

router.get('/get-products-by-category/:_id',
    validationHandler.validate(validationSchemas.idParamSchema, 'params'),
    categoryController.getProductsByCategory
);

router.get('/get-root-category',
    categoryController.getRootCategory
);

module.exports = router;
