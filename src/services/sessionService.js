const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Session = require('../models/AuthSession');
const config = require('../config/environment');
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
function accessToken(user, sessionId) {
  return jwt.sign({ userId: user._id, role: user.role, name: user.name, email: user.email, tokenVersion: user.tokenVersion, sid: sessionId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}
function setCookies(res, token, refresh, persistent) {
  res.cookie('token', token, options);
  res.cookie('refreshToken', refresh, { ...options, ...(persistent ? { maxAge: 30 * 86400000 } : {}) });
}
function clearCookies(res) { res.clearCookie('token', options); res.clearCookie('refreshToken', options); }
async function createSession(user, res, persistent = false) {
  const sessionId = crypto.randomUUID(), refresh = crypto.randomBytes(48).toString('hex');
  await Session.create({ sessionId, userId: user._id, tokenVersion: user.tokenVersion, refreshHash: hash(refresh), expiresAt: new Date(Date.now() + 30 * 86400000), persistent });
  const token = accessToken(user, sessionId); setCookies(res, token, refresh, persistent); return token;
}
module.exports = { hash, accessToken, setCookies, clearCookies, createSession };
