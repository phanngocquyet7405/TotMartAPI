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

      // Authorization must use the current database role, not a stale JWT claim.
      req.user = { ...decoded, role: user.role };
      req.userId = String(user._id);
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

      if (user.isActive === false) {
        return res.status(403).json({
          success: false,
          message: "Account is locked. Please contact Admin to support.",
        });
      }

      if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
        return res
          .status(401)
          .json({ success: false, message: "Token has been revoked." });
      }

      if (user.role !== "admin") {
        return res
          .status(403)
          .json({ success: false, message: "Access denied! Admins only" });
      }

      req.user = { ...decoded, role: user.role };
      req.userId = String(user._id);
      next();
    } catch (error) {
      next(error);
    }
  }

  requireOwnerOrAdmin(req, res, next) {
    // This guard must run after authentication and ID parameter validation.
    if (!req.userId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    const isOwner =
      String(req.userId).toLowerCase() === String(req.params._id).toLowerCase();
    if (!isOwner && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    next();
  }
}
module.exports = new authMiddleware();
