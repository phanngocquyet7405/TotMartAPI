const crypto = require("crypto");
const logger = require("../utils/logger");

class SepayAuth {
  verifyApiKey(req, res, next) {
    const configuredKey = process.env.SEPAY_API_KEY;
    if (!configuredKey) {
      logger.error(
        { ip: req.ip },
        "[sepayAuth] SEPAY_API_KEY chưa được cấu hình trong environment",
      );
      return res
        .status(500)
        .json({ success: false, message: "Webhook is not configured" });
    }

    const receivedHeader = req.headers["authorization"] || "";
    const tokenMatch = receivedHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
    const receivedToken = tokenMatch ? tokenMatch[1] : receivedHeader;

    const receivedBuf = Buffer.from(receivedToken);
    const expectedBuf = Buffer.from(configuredKey);

    const isValid =
      receivedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(receivedBuf, expectedBuf);

    if (!isValid) {
      logger.warn({ ip: req.ip }, "[sepayAuth] Webhook auth failed");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    next();
  }
}

module.exports = new SepayAuth();
