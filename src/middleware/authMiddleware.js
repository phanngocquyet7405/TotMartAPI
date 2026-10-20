const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");

const AuthSession = require("../models/AuthSession");

// Authenticate once at the route boundary. Every request reads current DB state.
async function authenticate(req, res, next, revokedMessage = "Token has been revoked. Please login again.") {
  try {
    const token = req.headers.authorization?.split(" ")[1] || req.cookies?.token;

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    const decoded = verifyToken(token);
    if (require('../config/sessionPolicy').strictSessions() && !decoded.sid) return res.status(401).json({success:false,message:'Login required for current session policy'});

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
        message: revokedMessage,
      });
    }

    if (decoded.sid && !await AuthSession.exists({ sessionId: decoded.sid, userId: user._id, tokenVersion: user.tokenVersion, revokedAt: null, expiresAt: { $gt: new Date() } })) return res.status(401).json({ success: false, message: "Session revoked" });
    // Authorization must use the current database role, not a stale JWT claim.
    req.user = { ...decoded, role: user.role };
    req.userId = String(user._id);
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(role, message = "Access denied") {
  return (req, res, next) => {
    if (!req.userId || !req.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (req.user.role !== role) return res.status(403).json({ success: false, message });
    next();
  };
}
const adminRole = requireRole("admin", "Access denied! Admins only");

const merchantRole = requireRole("merchant", "Khu vực dành riêng cho merchant");

class authMiddleware {
  authenticate(req, res, next) {
    return authenticate(req, res, next);
  }

  authMiddleware(req, res, next) {
    return authenticate(req, res, next);
  }

  // Compatibility entrypoint for routes that authenticate admin access directly.
  async adminMiddleware(req, res, next) {
    return authenticate(req, res, error => error ? next(error) : adminRole(req, res, next), "Token has been revoked.");
  }

  requireAdmin(req, res, next) {
    return adminRole(req, res, next);
  }

  requireMerchant(req, res, next) {
    return merchantRole(req, res, next);
  }

  requireRole(role, message = "Access denied") {
    return requireRole(role, message);
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

  customerCheckoutMiddleware(req, res, next) {
    // Merchants use quote for package previews, but purchases belong to a customer account.
    if (req.user?.role === 'merchant') return res.status(403).json({ success: false,
      message: 'Tài khoản merchant chỉ vận hành cửa hàng; dùng tài khoản khách hàng để mua hàng' });
    next();
  }
}
module.exports = new authMiddleware();
