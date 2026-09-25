const router = require("express").Router();
const controller = require("../controllers/customerOrderController");
const { authMiddleware } = require("../middleware/authMiddleware");
const validation = require("../middleware/validationHandler");
const { idParamSchema } = require("../middleware/validationSchemas");

router.use(authMiddleware);
router.get("/", controller.list);
router.get(
  "/:_id",
  validation.validate(idParamSchema, "params"),
  controller.detail,
);
module.exports = router;
