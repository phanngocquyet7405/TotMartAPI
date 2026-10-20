const bcrypt = require('bcrypt');
const { randomBytes } = require('node:crypto');
const cost = require('../config/environment').bcryptCost;
// A single asynchronous initialization per process, not per request.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), cost);
// Attach a rejection handler immediately; consumers still receive initialization errors.
dummyHash.catch(() => {});
function validNewPassword(password) {
  return (
    typeof password === 'string' &&
    password.isWellFormed() &&
    Buffer.byteLength(password, 'utf8') <= 72
  );
}
function rounds(hash) {
  return bcrypt.getRounds(hash);
}
function tokenVersionFence(version) {
  // Old documents may omit the field; Mongoose/auth already interpret that as 0.
  const observed = version ?? 0;
  return observed === 0
    ? { $or: [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] }
    : { tokenVersion: observed };
}
async function hashPassword(password, previousHash, minimumCost = cost) {
  if (!validNewPassword(password))
    throw Object.assign(
      new Error('Password must be well-formed Unicode and at most 72 UTF-8 bytes'),
      { statusCode: 400 },
    );
  return bcrypt.hash(
    password,
    Math.max(cost, minimumCost, previousHash ? rounds(previousHash) : 0),
  );
}
async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  const valid = await bcrypt.compare(password, storedHash);
  // Reduce the low-cost-legacy-vs-missing gap; this is not whole-request constant time.
  if (!valid && rounds(storedHash) < cost) await bcrypt.compare(password, await dummyHash);
  return valid;
}
async function rehashAfterLogin(User, user, password) {
  // Long legacy inputs remain verifiable but require an explicit reset, never a silent truncating rehash.
  if (!validNewPassword(password) || rounds(user.password) >= cost) return true;
  const observedHash = user.password;
  const upgraded = await hashPassword(password, observedHash);
  const result = await User.updateOne(
    {
      _id: user._id,
      password: observedHash,
      ...tokenVersionFence(user.tokenVersion),
      isActive: { $ne: false },
    },
    { $set: { password: upgraded } },
  );
  return result.matchedCount === 1;
}
module.exports = {
  cost,
  validNewPassword,
  hashPassword,
  verifyPassword,
  rehashAfterLogin,
  tokenVersionFence,
  dummyHash,
};
