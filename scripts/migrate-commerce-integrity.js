// Offline review workflow. No connection is made when imported by tests.
const fs = require('fs');
const mongoose = require('mongoose');
const Box = require('../src/models/Box');
const { migrate } = require('./migrate-merchant-ownership');
async function plan() {
  const ownership = await migrate();
  const changes = ownership.changes.map((c) => ({
    collection: c.collection,
    id: c.id,
    before: { ownerId: null },
    after: { ownerId: c.ownerId },
  }));
  const conflicts = [...ownership.unresolved];
  for (const box of await Box.find().lean()) {
    const a = box.internalSubscription,
      b = box.subscriptionOnly;
    if (typeof a === 'boolean' && typeof b === 'boolean' && a !== b) {
      conflicts.push({
        collection: Box.collection.name,
        id: String(box._id),
        reason: 'Box flags disagree; manual source/template review required',
        internalSubscription: a,
        subscriptionOnly: b,
      });
      continue;
    }
    const value = a === true || b === true;
    if (a !== value || b !== value)
      changes.push({
        collection: Box.collection.name,
        id: String(box._id),
        before: { internalSubscription: a ?? null, subscriptionOnly: b ?? null },
        after: { internalSubscription: value, subscriptionOnly: value },
      });
  }
  return {
    database: mongoose.connection.name,
    generatedAt: new Date().toISOString(),
    changes,
    conflicts,
  };
}
async function apply(report, rollback = false) {
  if (report.database !== mongoose.connection.name) throw new Error('Manifest database mismatch');
  if (report.conflicts?.length)
    throw new Error(
      'Manifest has unresolved conflicts; review a conflict-free plan before apply/rollback',
    );
  const entries = rollback ? [...report.changes].reverse() : report.changes;
  await mongoose.connection.transaction(async (session) => {
    for (const entry of entries) {
      if (!['products', 'boxes', 'subscriptiontemplates'].includes(entry.collection))
        throw new Error('Unsupported collection');
      const before = rollback ? entry.after : entry.before,
        after = rollback ? entry.before : entry.after;
      const convert = (values) =>
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            key === 'ownerId' && value ? new mongoose.Types.ObjectId(value) : value,
          ]),
        );
      const result = await mongoose.connection
        .collection(entry.collection)
        .updateOne(
          { _id: new mongoose.Types.ObjectId(entry.id), ...convert(before) },
          { $set: convert(after) },
          { session },
        );
      if (result.matchedCount !== 1)
        throw new Error(`Precheck/CAS failed: ${entry.collection}/${entry.id}`);
      if (
        !(await mongoose.connection
          .collection(entry.collection)
          .findOne({ _id: new mongoose.Types.ObjectId(entry.id), ...convert(after) }, { session }))
      )
        throw new Error('Postcheck failed');
    }
  });
}
async function main() {
  // Intentionally no dotenv: operator must explicitly provide reviewed DB URI.
  const uri = process.env.MIGRATION_MONGODB_URI;
  if (!uri)
    throw new Error('Set MIGRATION_MONGODB_URI explicitly; use a backup/staging clone first');
  await mongoose.connect(uri);
  try {
    const mode = process.argv[2] || '--dry-run',
      file = process.argv[3];
    if (mode === '--dry-run') {
      const report = await plan();
      if (file) fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx' });
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (!['--apply', '--rollback'].includes(mode) || !file)
        throw new Error(
          'Use --dry-run [manifest.json], --apply manifest.json or --rollback manifest.json',
        );
      if (process.env.MIGRATION_CONFIRM_DATABASE !== mongoose.connection.name)
        throw new Error('Confirm exact database name');
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      await apply(report, mode === '--rollback');
      console.log(JSON.stringify({ verification: await plan() }, null, 2));
    }
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
module.exports = { plan, apply };
