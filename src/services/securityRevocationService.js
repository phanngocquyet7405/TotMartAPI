const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/AuthSession');
const Outbox = require('../models/SecurityOutbox');
async function revoke({ userId, filter = {}, set = {}, unset = {}, actorId, reason, sessionId }) {
  if (!userId && !filter.resetPasswordToken) throw new Error('Revocation requires a user or reset token selector');
  let user;
  await mongoose.connection.transaction(async session => {
    const update = { $set: { ...set, ...(sessionId ? {} : { refreshToken: [] }) } };
    if (!sessionId) update.$inc = { tokenVersion: 1 };
    if (Object.keys(unset).length) update.$unset = unset;
    user = await User.findOneAndUpdate({ ...(userId ? { _id: userId } : {}), ...filter }, update, { new: true, session, runValidators: true });
    if (!user) return;
    if (sessionId) await Session.deleteOne({ userId: user._id, sessionId }, { session });
    else await Session.deleteMany({ userId: user._id }, { session });
    await Outbox.create([{ userId: user._id, tokenVersion: user.tokenVersion, sessionId, actorId, reason }], { session });
  });
  // Only after commit. Other instances close through outbox; heartbeat validates DB even if Pub/Sub was missed.
  if (user) require('../controllers/notificationController').terminateUserStreams(user._id);
  return user;
}
module.exports = { revoke };
