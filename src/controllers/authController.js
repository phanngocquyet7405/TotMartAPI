const User = require('../models/User');
const passwords = require('../services/passwordService');
const { findForAuthentication } = require('../services/userIdentityService');
const crypto = require('crypto');
const sendEmailWithBrevo = require('../utils/sendEmail');
const config = require('../config/environment');
const { terminateUserStreams } = require('./notificationController');

function rejectExpiredSession(res, clearCookies) {
  clearCookies(res);
  return res.status(401).json({ success: false, message: 'Session expired or revoked' });
}

function legacyPasswordNotice(password) {
  return !passwords.validNewPassword(password)
    ? { passwordChangeRequired: true, passwordPolicyReason: 'LEGACY_BCRYPT_BYTE_LIMIT' }
    : {};
}

class AuthController {
  async login(req, res, next) {
    try {
      const { email, password, rememberMe } = req.validatedBody;
      const user = await findForAuthentication(User, req.body.email ?? email);
      if (!(await passwords.verifyPassword(password, user?.password)))
        return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
      if (user.isActive === false)
        return res.status(403).json({ success: false, message: 'Account is locked' });
      if (!(await passwords.rehashAfterLogin(User, user, password)))
        return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
      const token = await require('../services/sessionService').createSession(
        user,
        res,
        rememberMe,
      );
      res.json({
        success: true,
        message: 'Login successful',
        token,
        ...legacyPasswordNotice(password),
      });
    } catch (err) {
      next(err);
    }
  }
  async refresh(req, res, next) {
    try {
      const {
        rotate,
        accessToken,
        setCookies,
        clearCookies,
      } = require('../services/sessionService');
      const updated = await rotate(req.cookies?.refreshToken);
      if (!updated) return rejectExpiredSession(res, clearCookies);
      const token = accessToken(updated.user, updated.sessionId);
      setCookies(res, token, updated.refresh, updated.persistent);
      res.json({ success: true, token });
    } catch (err) {
      next(err);
    }
  }
  async logout(req, res, next) {
    try {
      await require('../services/securityRevocationService').revoke({
        userId: req.userId,
        sessionId: req.user.sid,
        actorId: req.userId,
        reason: 'logout',
      });
      require('../services/sessionService').clearCookies(res);
      terminateUserStreams(req.userId, req.user.sid);
      res.json({ success: true, message: 'Logout successful' });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.validatedBody;
      const user = await findForAuthentication(User, req.body.email ?? email);
      if (!user) {
        return res.status(200).json({
          success: true,
          message: 'If the email is registered, a password reset link has been sent.',
        });
      }

      const resetToken = crypto.randomBytes(20).toString('hex');

      const issuedTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      // Query update only touches reset fields, never a stale whole user document.
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: issuedTokenHash,
            resetPasswordExpires: new Date(Date.now() + 10 * 60 * 1000),
          },
        },
      );

      // url frontend reset password
      const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

      try {
        const delivery = await sendEmailWithBrevo(
          user.email,
          'TotMart - Password Reset Link',
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

        if (!delivery?.success) throw new Error('Password reset email delivery failed');
        res.status(200).json({
          success: true,
          message: 'If the email is registered, a password reset link has been sent.',
        });
      } catch (error) {
        // An older delivery failure must not erase a newer request's token.
        require('../utils/logger').warn(
          { event: 'password_reset_delivery_failed' },
          'Password reset delivery failed',
        );
        try {
          await User.updateOne(
            { _id: user._id, resetPasswordToken: issuedTokenHash },
            { $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } },
          );
        } catch {
          require('../utils/logger').error(
            { event: 'password_reset_cleanup_failed' },
            'Password reset cleanup requires retry',
          );
        }
        return res.status(200).json({
          success: true,
          message: 'If the email is registered, a password reset link has been sent.',
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { password } = req.validatedBody;
      const token = req.body.token ?? req.query.token;
      if (typeof token !== 'string' || !/^[a-f0-9]{40}$/.test(token)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset password token',
        });
      }

      const resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');

      // Consume the token atomically so concurrent requests cannot reuse it.
      const previous = await User.findOne({
        resetPasswordToken,
        resetPasswordExpires: { $gt: new Date() },
      });
      if (!previous)
        return res
          .status(400)
          .json({ success: false, message: 'Invalid or expired reset password token' });
      const passwordHash = await passwords.hashPassword(password, previous.password);
      const user = await require('../services/securityRevocationService').revoke({
        filter: {
          _id: previous._id,
          password: previous.password,
          ...passwords.tokenVersionFence(previous.tokenVersion),
          resetPasswordToken,
          $expr: { $gt: ['$resetPasswordExpires', '$$NOW'] },
        },
        set: { password: passwordHash },
        unset: { resetPasswordToken: '', resetPasswordExpires: '' },
        reason: 'password_reset',
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset password token',
        });
      }

      require('../services/sessionService').clearCookies(res);

      res.status(200).json({
        success: true,
        message: 'Password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
