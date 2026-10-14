const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");

// Shared token/session verification. Returns the User document, or sends the
// error response itself and returns null. The role is NOT checked here.
async function resolveUser(req, res, { revokedMessage }) {
  const token = req.headers.authorization?.split(" ")[1] || req.cookies?.token;

  if (!token) {
    res.status(401).json({ success: false, message: "No token provided" });
    return null;
  }

  const decoded = verifyToken(token);
  if (process.env.NODE_ENV === 'production' && !decoded.sid) {
    res.status(401).json({ success: false, message: 'Login required for current session policy' });
    return null;
  }

  const user = await User.findById(decoded.userId);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return null;
  }

  if (user.isActive === false) {
    res.status(403).json({
      success: false,
      message: "Account is locked. Please contact Admin to support.",
    });
    return null;
  }

  if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
    res.status(401).json({ success: false, message: revokedMessage });
    return null;
  }

  if (decoded.sid && !await require("../models/AuthSession").exists({ sessionId: decoded.sid, userId: user._id, tokenVersion: user.tokenVersion, expiresAt: { $gt: new Date() } })) {
    res.status(401).json({ success: false, message: "Session revoked" });
    return null;
  }

  req.decodedToken = decoded;
  return user;
}

function attach(req, user) {
  // Authorization must use the current database role, not a stale JWT claim.
  req.user = { ...req.decodedToken, role: user.role };
  req.userId = String(user._id);
  delete req.decodedToken;
}

class authMiddleware {
  async authMiddleware(req, res, next) {
    try {
      const user = await resolveUser(req, res, {
        revokedMessage: "Token has been revoked. Please login again.",
      });
      if (!user) return;
      attach(req, user);
      next();
    } catch (error) {
      next(error);
    }
  }

  async adminMiddleware(req, res, next) {
    try {
      const user = await resolveUser(req, res, {
        revokedMessage: "Token has been revoked.",
      });
      if (!user) return;
      if (user.role !== "admin") {
        return res
          .status(403)
          .json({ success: false, message: "Access denied! Admins only" });
      }
      attach(req, user);
      next();
    } catch (error) {
      next(error);
    }
  }

  // Admin OR merchant. Controllers must still scope merchants to their own
  // data (see services/merchantScope.js); this guard only opens the door.
  async staffMiddleware(req, res, next) {
    try {
      const user = await resolveUser(req, res, {
        revokedMessage: "Token has been revoked.",
      });
      if (!user) return;
      if (user.role !== "admin" && user.role !== "merchant") {
        return res
          .status(403)
          .json({ success: false, message: "Access denied! Admins or merchants only" });
      }
      attach(req, user);
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
