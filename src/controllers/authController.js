const User = require("../models/User");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const sendEmailWithBrevo = require("../utils/sendEmail");
const config = require("../config/environment");
const { terminateUserStreams } = require("./notificationController");

class AuthController {
  async login(req, res, next) {
    try {
      const { email, password, rememberMe } = req.validatedBody;
      const user = await User.findOne({ email });
      if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
      if (user.isActive === false) return res.status(403).json({ success: false, message: 'Account is locked' });
      const token = await require('../services/sessionService').createSession(user, res, rememberMe);
      res.json({ success: true, message: 'Login successful', token });
    } catch (err) { next(err); }
  }
  async refresh(req, res, next) {
    try {
      const Session = require('../models/AuthSession');
      const { hash, accessToken, setCookies, clearCookies } = require('../services/sessionService');
      const refresh = req.cookies.refreshToken;
      if (typeof refresh !== 'string' || !/^[a-f0-9]{96}$/.test(refresh)) { clearCookies(res); return res.status(401).json({ success: false, message: 'Phiên đã hết hạn' }); }
      const current = await Session.findOne({ refreshHash: hash(refresh), expiresAt: { $gt: new Date() } });
      const user = current && await User.findById(current.userId);
      if (!user || !user.isActive || current.tokenVersion !== user.tokenVersion) { clearCookies(res); return res.status(401).json({ success: false, message: 'Phiên đã bị thu hồi' }); }
      const rotated = crypto.randomBytes(48).toString('hex');
      const updated = await Session.findOneAndUpdate({ _id: current._id, refreshHash: hash(refresh) }, { refreshHash: hash(rotated) }, { new: true });
      if (!updated) return res.status(401).json({ success: false, message: 'Refresh token đã được sử dụng' });
      const token = accessToken(user, updated.sessionId); setCookies(res, token, rotated, updated.persistent);
      res.json({ success: true, token });
    } catch (err) { next(err); }
  }
  async logout(req, res, next) {
    try {
      const Session = require('../models/AuthSession');
      if (req.user.sid) await Session.deleteOne({ sessionId: req.user.sid, userId: req.userId });
      else { await User.updateOne({ _id: req.userId }, { $inc: { tokenVersion: 1 }, $set: { refreshToken: [] } }); await Session.deleteMany({ userId: req.userId }); }
      require('../services/sessionService').clearCookies(res); terminateUserStreams(req.userId);
      res.json({ success: true, message: 'Logout successful' });
    } catch (err) { next(err); }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(200).json({
          success: true,
          message:
            "If the email is registered, a password reset link has been sent.",
        });
      }

      const resetToken = crypto.randomBytes(20).toString("hex");

      user.resetPasswordToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");
      user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 min

      await user.save();

      // url frontend reset password
      const issuedTokenHash = user.resetPasswordToken;
      const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

      try {
        const delivery = await sendEmailWithBrevo(
          user.email,
          "TotMart - Password Reset Link",
          `
    <div style="font-family: Arial, sans-serif; max-width: 450px; margin: auto;">
        <h2 style="color: #4CAF50;">TotMart</h2>
        <p>Xin chào,</p>
        <p>Nhấp vào link bên dưới để đặt lại mật khẩu của bạn (có hiệu lực 10 phút):</p>
        <p><a href="${resetUrl}" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; display: inline-block;">Đặt lại mật khẩu</a></p>
        <p>Hoặc copy link: ${resetUrl}</p>
        <hr>
        <p style="color: #999; font-size: 12px;">Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
        <p style="color: #999; font-size: 12px;">TotMart - Your Trusted Shopping Partner</p>
    </div>
    `,
        );

        if (!delivery?.success)
          throw new Error("Password reset email delivery failed");
        res.status(200).json({
          success: true,
          message:
            "If the email is registered, a password reset link has been sent.",
        });
      } catch (error) {
        // An older delivery failure must not erase a newer request's token.
        await User.updateOne(
          { _id: user._id, resetPasswordToken: issuedTokenHash },
          { $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } },
        );
        return res.status(500).json({
          success: false,
          message: "Email could not be sent. Please try again later.",
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { password } = req.body;
      const token = req.query.token;
      if (typeof token !== "string" || !/^[a-f0-9]{40}$/.test(token)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid or expired reset password token",
          });
      }

      const resetPasswordToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      // Consume the token atomically so concurrent requests cannot reuse it.
      const passwordHash = await bcrypt.hash(password, 9);
      const user = await User.findOneAndUpdate(
        { resetPasswordToken, resetPasswordExpires: { $gt: Date.now() } },
        {
          $set: { password: passwordHash, refreshToken: [] },
          $unset: { resetPasswordToken: "", resetPasswordExpires: "" },
          $inc: { tokenVersion: 1 },
        },
      );

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset password token",
        });
      }

      await require("../models/AuthSession").deleteMany({ userId: user._id });
      terminateUserStreams(user._id);
      res.clearCookie("token");
      res.clearCookie("refreshToken");

      res.status(200).json({
        success: true,
        message: "Password updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
