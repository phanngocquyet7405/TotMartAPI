require('dotenv').config();
const mongoose = require('mongoose');
const Box = require('../src/models/Box');
const Subscription = require('../src/models/UserSubscription');
const BoxVersion = require('../src/models/BoxVersion');
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (process.argv.includes('--apply')) {
      // Initialize metadata only. Never infer historical purchased contents.
      await Box.collection.updateMany({ definitionVersion: { $exists: false } }, { $set: { definitionVersion: 1 } });
      await Box.collection.updateMany({ obligationRevision: { $exists: false } }, { $set: { obligationRevision: 0 } });
      await Box.collection.updateMany({ archivedAt: { $exists: false } }, { $set: { archivedAt: null } });
      await BoxVersion.createIndexes();
      await Subscription.createIndexes();
    }
    const legacy = await Subscription.find({ $or: [
      { boxVersionId: null }, { gift: { $elemMatch: { versionId: null } } },
    ] }).select('_id boxId status paymentStatus gift.boxId').lean();
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply_metadata' : 'read_only',
      legacySubscriptions: legacy.map(s => ({ id: String(s._id), boxId: String(s.boxId),
        status: s.status, paymentStatus: s.paymentStatus,
        giftBoxIds: s.gift.map(g => String(g.boxId)) })),
      note: 'Missing historical versions require verified purchase evidence; no automatic snapshot backfill.' }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
