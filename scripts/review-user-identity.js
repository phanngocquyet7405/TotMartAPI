// Dry-run by default. The only apply capability is a DB this module provisions itself.
// Does not load .env/config or create/drop indexes when inspecting an external DB.
const { MongoClient } = require('mongoose').mongo;
const { createHash } = require('node:crypto');
const { canonicalEmail } = require('../src/services/userIdentityService');
const owned = new WeakSet();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function displayNameIndex(index) {
  const keys = Object.entries(index.key);
  const known = ['v','key','name','ns','unique','sparse','collation','background','hidden'];
  return index.unique === true && keys.length === 1 && keys[0][0] === 'name'
    && [1,-1].includes(keys[0][1]) && Object.keys(index).every(k => known.includes(k));
}
async function inspectIdentity(db) {
  const collection = db.collection('users');
  const indexes = await collection.listIndexes().toArray();
  const users = await collection.find({}, { projection: { _id: 1, email: 1, name: 1 } }).sort({ _id: 1 }).toArray();
  const groups = new Map(), changes = [], invalid = [];
  for (const user of users) {
    if (typeof user.email !== 'string' || !user.email.trim()) { invalid.push(String(user._id)); continue; }
    const email = canonicalEmail(user.email);
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(String(user._id));
    if (email !== user.email) changes.push({ _id: user._id, before: user.email, after: email });
  }
  const manualReviewIndexes = indexes.filter(i=>i.unique === true && Object.keys(i.key).length === 1 && Object.hasOwn(i.key,'name') && !displayNameIndex(i));
  return { indexes, candidates: indexes.filter(displayNameIndex), manualReviewIndexes, usersSignature: digest(users),
    collisionGroups: [...groups.values()].filter(ids => ids.length > 1), invalid,
    changes, userCount: users.length };
}
function report(plan) {
  return { mode: 'dry-run', userCount: plan.userCount, proposedEmailUpdates: plan.changes.length,
    collisionGroups: plan.collisionGroups, invalidEmailRecordIds: plan.invalid,
    indexes: plan.indexes.map(index => ({ name: index.name, key: index.key, unique: index.unique === true,
      sparse: index.sparse === true, hasPartialFilter: !!index.partialFilterExpression,
      collation: index.collation ? { locale: index.collation.locale, strength: index.collation.strength } : null,
      eligibleDisplayNameIndex: displayNameIndex(index) })),
    manualReviewIndexNames: plan.manualReviewIndexes.map(i=>i.name),
    ready: !plan.collisionGroups.length && !plan.invalid.length && !plan.manualReviewIndexes.length };
}
function assertOwned(db) {
  if (!owned.has(db)) throw new Error('Apply/rollback only permits the disposable DB provisioned in this invocation');
}
async function applyDisposable(db, plan) {
  assertOwned(db);
  const current = await inspectIdentity(db);
  if (plan.collisionGroups.length || plan.invalid.length || current.collisionGroups.length || current.invalid.length)
    throw new Error('Identity collisions/invalid emails require an operator decision manifest; no changes applied');
  if (plan.manualReviewIndexes.length || current.manualReviewIndexes.length) throw new Error('Display index options require manual review; no changes applied');
  if (current.usersSignature !== plan.usersSignature || digest(current.indexes) !== digest(plan.indexes))
    throw new Error('Identity plan is stale; rerun dry-run');
  // No canonical unique index or collation change. Existing exact email unique index is retained.
  // External writers must be paused in a future reviewed shared-environment procedure.
  const collection = db.collection('users');
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const change of plan.changes) {
        const result = await collection.updateOne({ _id: change._id, email: change.before }, { $set: { email: change.after } }, { session });
        if (result.matchedCount !== 1) throw new Error('Email preimage changed; rerun dry-run');
      }
    });
  } finally { await session.endSession(); }
  for (const index of plan.candidates) {
    const latest = (await collection.listIndexes().toArray()).find(i => i.name === index.name);
    if (!latest || digest(latest) !== digest(index) || !displayNameIndex(latest)) throw new Error('Display index changed; refusing drop');
    await collection.dropIndex(index.name);
  }
  return { emailUpdates: plan.changes.length, droppedDisplayIndexes: plan.candidates.map(i=>i.name) };
}
async function rollbackDisplayIndexes(db, plan) {
  assertOwned(db);
  const results = [];
  for (const index of plan.candidates) {
    // Compare with the original index's collation; sparse excludes missing names.
    const pipeline = [...(index.sparse ? [{ $match: { name: { $exists: true } } }] : []),
      { $group: { _id: { $ifNull: ['$name', null] }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }];
    if ((await db.collection('users').aggregate(pipeline, index.collation ? { collation: index.collation } : {}).toArray()).length) {
      results.push({ index: index.name, restored: false, reason: 'DUPLICATE_DISPLAY_NAMES_REVIEW_REQUIRED' });
      continue;
    }
    const { v, ns, key, ...options } = index;
    await db.collection('users').createIndex(key, options);
    results.push({ index: index.name, restored: true });
  }
  return results;
}
async function withDisposableIdentityDb(work) {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const repl = new MongoMemoryReplSet({ replSet: { count: 1, storageEngine: 'wiredTiger' }, binary: { version: '7.0.14' } });
  let client, db;
  try {
    await repl.start();
    client = new MongoClient(repl.getUri());
    await client.connect();
    db = client.db('totmart_test');
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.isWritablePrimary || !hello.setName) throw new Error('Disposable replica set is not PRIMARY');
    await db.createCollection('users');
    owned.add(db);
    return await work(db);
  } finally {
    if (db) owned.delete(db);
    try { await client?.close(); } finally { await repl.stop(); }
  }
}
async function main() {
  if (process.argv.length !== 3 || !['--dry-run','--apply-disposable'].includes(process.argv[2])) throw new Error('Use --dry-run or --apply-disposable');
  if (process.argv[2] === '--apply-disposable') {
    const result = await withDisposableIdentityDb(async db => {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ name: 1 }, { unique: true, name: 'legacy_display_unique' });
      await db.collection('users').insertOne({ name: 'Synthetic display', email: ' Synthetic@Example.test ' });
      const plan = await inspectIdentity(db), before = report(plan), applied = await applyDisposable(db, plan);
      await db.collection('users').insertOne({ name: 'Synthetic display', email: 'second@example.test' });
      return { before, applied, rollback: await rollbackDisplayIndexes(db, plan), disposable: true };
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!process.env.B03_MONGODB_URI) throw new Error('Set B03_MONGODB_URI explicitly for a read-only dry-run');
  const client = new MongoClient(process.env.B03_MONGODB_URI);
  try { await client.connect(); console.log(JSON.stringify(report(await inspectIdentity(client.db())), null, 2)); }
  finally { await client.close(); }
}
module.exports = { displayNameIndex, inspectIdentity, report, applyDisposable, rollbackDisplayIndexes, withDisposableIdentityDb };
if (require.main === module) main().catch(() => { console.error('Identity review refused or failed; no credentials or record values logged'); process.exitCode = 1; });
