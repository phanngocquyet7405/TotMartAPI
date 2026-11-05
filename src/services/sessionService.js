const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Session = require('../models/AuthSession');
const config = require('../config/environment');
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const options = () => ({
  httpOnly: true,
  secure: require('../config/sessionPolicy').strictSessions(),
  sameSite: 'lax',
  path: '/',
});
function accessToken(user, sessionId) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      tokenVersion: user.tokenVersion,
      sid: sessionId,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}
function setCookies(res, token, refresh, persistent) {
  res.cookie('token', token, options());
  res.cookie('refreshToken', refresh, {
    ...options(),
    ...(persistent ? { maxAge: 30 * 86400000 } : {}),
  });
}
function clearCookies(res) {
  res.clearCookie('token', options());
  res.clearCookie('refreshToken', options());
}
async function createSession(user, res, persistent = false) {
  const sessionId = crypto.randomUUID(),
    refresh = crypto.randomBytes(48).toString('hex');
  await Session.create({
    sessionId,
    userId: user._id,
    tokenVersion: user.tokenVersion,
    refreshHash: hash(refresh),
    expiresAt: new Date(Date.now() + 30 * 86400000),
    persistent,
  });
  const token = accessToken(user, sessionId);
  setCookies(res, token, refresh, persistent);
  return token;
}
// Stable across processes; only hashes of presented/derived credentials reach MongoDB.
const successor = (refresh, sid) =>
  crypto
    .createHmac('sha384', config.jwt.refreshSecret)
    .update('totmart-refresh-v1\0')
    .update(sid)
    .update('\0')
    .update(refresh)
    .digest('hex');
function acceptRotationOrRecovery(family, presentedHash, next, now) {
  if (family.refreshHash === presentedHash && family.history.length < 4096) {
    family.history.push({ hash: presentedHash, consumedAt: now, retries: 0 });
    family.refreshHash = hash(next);
    return true;
  }
  const consumed = family.history.find((entry) => entry.hash === presentedHash);
  if (
    consumed &&
    now - consumed.consumedAt < 30000 &&
    consumed.retries < 2 &&
    family.refreshHash === hash(next)
  ) {
    consumed.retries += 1;
    return true;
  }
  return false;
}
async function revokeReusedFamily(family, user, now, transaction) {
  family.revokedAt = now;
  await family.save({ session: transaction });
  await require('../models/SecurityOutbox').create(
    [
      {
        userId: user._id,
        sessionId: family.sessionId,
        tokenVersion: user.tokenVersion,
        reason: 'refresh_reuse_or_limit',
      },
    ],
    { session: transaction },
  );
  return { userId: user._id, sessionId: family.sessionId };
}
async function rotate(refresh) {
  if (typeof refresh !== 'string' || !/^[a-f0-9]{96}$/.test(refresh)) return null;
  let result, revoked;
  await require('mongoose').connection.transaction(async (transaction) => {
    result = null;
    revoked = null;
    const now = new Date(),
      presentedHash = hash(refresh);
    const family = await Session.findOne({
      $or: [{ refreshHash: presentedHash }, { 'history.hash': presentedHash }],
      expiresAt: { $gt: now },
      revokedAt: null,
    }).session(transaction);
    if (!family) return;
    const user = await require('../models/User').findById(family.userId).session(transaction);
    if (!user || user.isActive === false || user.tokenVersion !== family.tokenVersion) return;
    const next = successor(refresh, family.sessionId);
    if (!acceptRotationOrRecovery(family, presentedHash, next, now)) {
      revoked = await revokeReusedFamily(family, user, now, transaction);
      return;
    }
    await family.save({ session: transaction });
    result = { user, sessionId: family.sessionId, refresh: next, persistent: family.persistent };
  });
  if (revoked)
    require('../controllers/notificationController').terminateUserStreams(
      revoked.userId,
      revoked.sessionId,
    );
  return result;
}
module.exports = { hash, accessToken, setCookies, clearCookies, createSession, rotate };
