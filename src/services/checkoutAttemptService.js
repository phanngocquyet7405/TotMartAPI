const mongoose = require('mongoose');
const Attempt = require('../models/CheckoutAttempt');
const Checkout = require('../models/Checkout');
const User = require('../models/User');
const { deliverySnapshot } = require('./deliverySnapshot');
const { requestHash } = require('./checkoutLifecycle');
const { AUTH_READ_TIMEOUT_MS } = require('../config/authReadPolicy');
const error = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });
function check(attempt, hash) {
  if (attempt.hash !== hash) throw error('ATTEMPT_PAYLOAD_MISMATCH');
  if (attempt.state === 'invalidated') throw error('ATTEMPT_INVALIDATED');
  if (attempt.state === 'rejected')
    throw Object.assign(error(attempt.error.code, attempt.error.statusCode), {
      message: attempt.error.message,
    });
  return attempt;
}
async function insertAttempt(values, session) {
  // A durable per-user write fence serializes admission across instances. Never prune tombstones.
  // Count existing legacy attempts too; a rate window alone cannot bound lifetime storage.
  const owner = await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(values.userId) },
    { $inc: { checkoutAttemptRevision: 1 } },
    { session },
  );
  if (owner.matchedCount !== 1) throw error('ATTEMPT_USER_NOT_FOUND', 404);
  if ((await Attempt.countDocuments({ userId: values.userId }).session(session)) >= 10000)
    throw error('ATTEMPT_CAPACITY_REACHED', 429);
  const [attempt] = await Attempt.create([values], { session });
  return attempt;
}
async function prepare(userId, kind, key, hash, body) {
  let attempt = await Attempt.findOne({ userId, kind, key }).setOptions({
    timeoutMS: AUTH_READ_TIMEOUT_MS,
  });
  if (attempt) return check(attempt, hash);
  let address;
  if (kind === 'products') {
    const user = await User.findById(userId).setOptions({ timeoutMS: AUTH_READ_TIMEOUT_MS });
    const selected = user?.addresses.id(body.addressId);
    if (!selected) throw error('ADDRESS_NOT_FOUND', 400);
    address = deliverySnapshot(user, selected);
    if (body.addressHash && body.addressHash !== requestHash(address))
      throw error('ADDRESS_CHANGED');
  }
  try {
    await mongoose.connection.transaction(async (session) => {
      attempt = await Attempt.findOne({ userId, kind, key }).session(session);
      if (!attempt) attempt = await insertAttempt({ userId, kind, key, hash, address }, session);
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    attempt = await Attempt.findOne({ userId, kind, key }).setOptions({
      timeoutMS: AUTH_READ_TIMEOUT_MS,
    });
  }
  return check(attempt, hash);
}
async function lock(userId, kind, key, hash, session) {
  const attempt = await Attempt.findOneAndUpdate(
    { userId, kind, key },
    { $inc: { revision: 1 } },
    { new: true, session },
  );
  if (!attempt) throw error('ATTEMPT_MISSING');
  return check(attempt, hash);
}
async function complete(userId, kind, key, result, session) {
  await Attempt.updateOne(
    { userId, kind, key, state: 'processing' },
    { $set: { state: 'created', result } },
    { session },
  );
}
async function reject(userId, kind, key, hash, err) {
  const statusCode = err.statusCode || err.status;
  if (statusCode < 400 || statusCode >= 500 || !statusCode) return;
  await Attempt.updateOne(
    { userId, kind, key, hash, state: 'processing' },
    {
      $set: {
        state: 'rejected',
        error: { code: err.code || 'ATTEMPT_REJECTED', statusCode, message: err.message },
      },
      $inc: { revision: 1 },
    },
  );
}
async function resolve(userId, kind, key, hash, terminate = false) {
  let data;
  await mongoose.connection.transaction(async (session) => {
    // Legacy checkout uniqueness remains global per user/key. Never invalidate a committed checkout.
    const checkout = await Checkout.findOne({ userId, requestKey: key }).session(session);
    if (checkout) {
      if ((checkout.kind || 'products') !== kind || checkout.requestHash !== hash)
        throw error('ATTEMPT_PAYLOAD_MISMATCH');
      data = { state: 'created', result: checkout.result, canRestart: false };
      return;
    }
    let attempt = terminate
      ? await Attempt.findOneAndUpdate(
          { userId, kind, key },
          { $inc: { revision: 1 } },
          { new: true, session },
        )
      : await Attempt.findOne({ userId, kind, key }).session(session);
    if (attempt && attempt.hash !== hash) throw error('ATTEMPT_PAYLOAD_MISMATCH');
    if (terminate && !attempt)
      attempt = await insertAttempt({ userId, kind, key, hash, state: 'invalidated' }, session);
    if (terminate && attempt.state !== 'created') {
      attempt.state = 'invalidated';
      await attempt.save({ session });
    }
    data = attempt
      ? {
          state: attempt.state,
          result: attempt.result,
          error: attempt.error,
          canRestart: attempt.state === 'invalidated',
        }
      : { state: 'unknown', canRestart: false };
  });
  return data;
}
module.exports = { prepare, lock, complete, reject, resolve };
