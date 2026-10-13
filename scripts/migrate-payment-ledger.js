// Classify historical records only; NEVER invent receipt allocations or paid snapshots.
// Dry run by default. Stop traffic and verify a restore before --apply.
require('dotenv').config();
const mongoose = require('mongoose');
async function run() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI explicitly');
  await mongoose.connect(process.env.MONGODB_URI, {autoIndex:false,autoCreate:false});
  const db = mongoose.connection.db;
  const checkouts = db.collection('checkouts'), events = db.collection('paymentevents');
  const missing = {paymentLedgerVersion:{$exists:false}};
  const [checkoutCount,eventCount,openCheckoutCount,unresolvedEventCount] = await Promise.all([
    checkouts.countDocuments(missing),events.countDocuments(missing),
    checkouts.countDocuments({$or:[missing,{paymentLedgerVersion:1}],state:'pending'}),
    events.countDocuments({$or:[missing,{paymentLedgerVersion:1}],state:{$ne:'processed'}}),
  ]);
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'classify_legacy':'dry_run',checkoutCount,eventCount,openCheckoutCount,unresolvedEventCount,
    warning:'Open legacy obligations require verified bank evidence and a reviewed migration. This script does not make them v2.'},null,2));
  if (!process.argv.includes('--apply')) return;
  await mongoose.connection.transaction(async session => {
    await checkouts.updateMany(missing,{$set:{paymentLedgerVersion:1}},{session});
    await events.updateMany({...missing,state:'processed'},{$set:{paymentLedgerVersion:1,disposition:'legacy_processed'}},{session});
    await events.updateMany({...missing,state:{$ne:'processed'}},{$set:{paymentLedgerVersion:1,disposition:'legacy_review'}},{session});
  });
}
run().catch(() => {console.error('Ledger migration failed; check database access, topology and reviewed migration plan.');process.exitCode=1;}).finally(()=>mongoose.disconnect());
