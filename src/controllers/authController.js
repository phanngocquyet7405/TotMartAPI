const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const sendEmailWithBrevo = require("../utils/sendEmail");
const config = require("../config/environment");

class AuthController {
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }
      const token = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
          avatar: user.avatar,
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn },
      );

      const refreshToken = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
          avatar: user.avatar,
        },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn },
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 30,
      });
      user.refreshToken.push(refreshToken);
      await user.save();
      res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        refreshToken,
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const refreshToken = req.cookies.refreshToken;
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token not found",
        });
      }
      const user = await User.findOne({ refreshToken: refreshToken });
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid refresh token",
        });
      }
      user.refreshToken = user.refreshToken.filter(
        (token) => token !== refreshToken,
      );
      await user.save();
      res.clearCookie("token");
      res.clearCookie("refreshToken");
      res.status(200).json({
        success: true,
        message: "Logout successful",
      });
    } catch (error) {
      next(error);
    }
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
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
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
