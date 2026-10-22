// Offline review workflow. No connection is made when imported by tests.
const fs = require('fs');
const mongoose = require('mongoose');
const Box = require('../src/models/Box');
const { migrate } = require('./migrate-merchant-ownership');
const fields = {
  products: ['ownerId'],
  boxes: ['ownerId', 'internalSubscription', 'subscriptionOnly'],
  subscriptiontemplates: ['ownerId'],
};
const preimage = (doc, key) =>
  Object.hasOwn(doc, key)
    ? { exists: true, value: key === 'ownerId' && doc[key] ? String(doc[key]) : doc[key] }
    : { exists: false };
function validateManifest(report) {
  if (report?.version !== 2)
    throw new Error(
      'Manifest version 2 required; legacy preimages are ambiguous. Generate a new dry-run on the unchanged clone; never guess missing fields.',
    );
  if (report.database !== mongoose.connection.name) throw new Error('Manifest database mismatch');
  if (!Array.isArray(report.changes) || !Array.isArray(report.conflicts))
    throw new Error('Invalid manifest arrays');
  if (report.conflicts.length)
    throw new Error(
      'Manifest has unresolved conflicts; review a conflict-free plan before apply/rollback',
    );
  const touched = new Set();
  for (const entry of report.changes) {
    if (!fields[entry.collection]) throw new Error('Unsupported collection');
    if (!/^[a-f0-9]{24}$/i.test(entry.id || '')) throw new Error('Invalid manifest id');
    const keys = Object.keys(entry.before || {});
    if (
      !keys.length ||
      keys.sort().join(',') !==
        Object.keys(entry.after || {})
          .sort()
          .join(',')
    )
      throw new Error('Invalid manifest field sets');
    for (const key of keys) {
      const target = `${entry.collection}/${entry.id}/${key}`;
      if (!fields[entry.collection].includes(key) || touched.has(target))
        throw new Error('Invalid manifest field/duplicate');
      touched.add(target);
      for (const [side, state] of [
        ['before', entry.before[key]],
        ['after', entry.after[key]],
      ]) {
        if (
          !state ||
          typeof state.exists !== 'boolean' ||
          Object.keys(state).sort().join(',') !== (state.exists ? 'exists,value' : 'exists')
        )
          throw new Error('Invalid manifest presence/value');
        if (side === 'after' && !state.exists) throw new Error('Invalid manifest after presence');
        if (!state.exists) continue;
        const value = state.value;
        if (key === 'ownerId') {
          if (side === 'before' && value !== null)
            throw new Error(
              'Manifest owner preimage must be unassigned; ownership transfer is forbidden',
            );
          if (
            !(value === null && side === 'before') &&
            !(typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))
          )
            throw new Error('Invalid manifest owner value');
        } else if (
          side === 'after'
            ? typeof value !== 'boolean'
            : !(
                value === null ||
                ['boolean', 'string'].includes(typeof value) ||
                (typeof value === 'number' && Number.isFinite(value))
              )
        )
          throw new Error('Invalid manifest flag value');
      }
    }
  }
}
async function plan() {
  const ownership = await migrate();
  const changes = [];
  for (const c of ownership.changes) {
    const doc = await mongoose.connection
      .collection(c.collection)
      .findOne({ _id: new mongoose.Types.ObjectId(c.id) });
    if (!doc) throw new Error('Document disappeared during dry-run');
    if (Object.hasOwn(doc, 'ownerId') && doc.ownerId !== null)
      throw new Error('Ownership changed during dry-run; refusing to plan an ownership transfer');
    changes.push({
      collection: c.collection,
      id: c.id,
      before: { ownerId: preimage(doc, 'ownerId') },
      after: { ownerId: { exists: true, value: c.ownerId } },
    });
  }
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
        before: {
          internalSubscription: preimage(box, 'internalSubscription'),
          subscriptionOnly: preimage(box, 'subscriptionOnly'),
        },
        after: {
          internalSubscription: { exists: true, value },
          subscriptionOnly: { exists: true, value },
        },
      });
  }
  return {
    version: 2,
    database: mongoose.connection.name,
    generatedAt: new Date().toISOString(),
    changes,
    conflicts,
  };
}
async function apply(report, rollback = false) {
  validateManifest(report);
  const entries = rollback ? [...report.changes].reverse() : report.changes;
  await mongoose.connection.transaction(async (session) => {
    for (const entry of entries) {
      if (!['products', 'boxes', 'subscriptiontemplates'].includes(entry.collection))
        throw new Error('Unsupported collection');
      const before = rollback ? entry.after : entry.before,
        after = rollback ? entry.before : entry.after;
      const convert = (key, value) =>
        key === 'ownerId' && value ? new mongoose.Types.ObjectId(value) : value;
      const filter = (values) =>
        Object.fromEntries(
          Object.entries(values).map(([key, state]) => [
            key,
            state.exists ? { $exists: true, $eq: convert(key, state.value) } : { $exists: false },
          ]),
        );
      const set = {},
        unset = {};
      for (const [key, state] of Object.entries(after)) {
        if (state.exists) set[key] = convert(key, state.value);
        else unset[key] = ''; // Exact document/field preimage only; never a bulk unset.
      }
      const result = await mongoose.connection.collection(entry.collection).updateOne(
        { _id: new mongoose.Types.ObjectId(entry.id), ...filter(before) },
        {
          ...(Object.keys(set).length ? { $set: set } : {}),
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        { session },
      );
      if (result.matchedCount !== 1)
        throw new Error(`Precheck/CAS failed: ${entry.collection}/${entry.id}`);
      if (
        !(await mongoose.connection
          .collection(entry.collection)
          .findOne({ _id: new mongoose.Types.ObjectId(entry.id), ...filter(after) }, { session }))
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
module.exports = { plan, apply, validateManifest };
