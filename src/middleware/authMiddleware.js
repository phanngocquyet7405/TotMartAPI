const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");

class authMiddleware {
  async authMiddleware(req, res, next) {
    try {
      const token = req.headers.authorization?.split(" ")[1];

      if (!token) {
        return res
          .status(401)
          .json({ success: false, message: "No token provided" });
      }

      const decoded = verifyToken(token);

      const user = await User.findById(decoded.userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.isActive === false) {
        return res.status(403).json({
          success: false,
          message: "Account is locked. Please contact Admin to support.",
        });
      }

      if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
        return res.status(401).json({
          success: false,
          message: "Token has been revoked. Please login again.",
        });
      }

      req.user = decoded;
      req.userId = decoded.userId;
      next();
    } catch (error) {
      next(error);
    }
  }

  async adminMiddleware(req, res, next) {
    try {
      const token = req.headers.authorization?.split(" ")[1];

      if (!token) {
        return res
          .status(401)
          .json({ success: false, message: "No token provided" });
      }

      const decoded = verifyToken(token);

      const user = await User.findById(decoded.userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
        return res
          .status(401)
          .json({ success: false, message: "Token has been revoked." });
      }

      if (decoded.role !== "admin" && user.role !== "admin") {
        return res
          .status(403)
          .json({ success: false, message: "Access denied! Admins only" });
      }

      req.userId = decoded.userId;
      next();
    } catch (error) {
      next(error);
    }
  }
}
module.exports = new authMiddleware();
