const mongoose = require('mongoose');
const { fork } = require('node:child_process');
const { mongo, write, sha, run } = require('./helpers/roundC1/context');
const script = require('../scripts/migrate-commerce-integrity');
const { BSON } = mongoose.mongo;
let fixture, db, original, manifest, ids, sourceDb, sourceSnapshot;
async function snapshot(target) {
  const result = {};
  for (const item of (await target.listCollections().toArray()).sort((a, b) =>
    a.name.localeCompare(b.name),
  ))
    result[item.name] = {
      fingerprint: sha(
        BSON.EJSON.stringify(await target.collection(item.name).find().sort({ _id: 1 }).toArray()),
      ),
      indexes: (await target.collection(item.name).indexes())
        .map((i) => ({ ...i, key: Object.entries(i.key) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  return result;
}
const hash = async (names) =>
  sha(
    BSON.EJSON.stringify(
      await Promise.all(names.map((n) => db.collection(n).find().sort({ _id: 1 }).toArray())),
    ),
  );
const protectedNames = [
  'checkouts',
  'orders',
  'checkoutattempts',
  'paymentevents',
  'paymentallocations',
  'receiptrefunds',
  'authsessions',
];
beforeAll(async () => {
  fixture = await mongo('migration');
  await fixture.assertTarget();
  await mongoose.connect(fixture.uri(fixture.database));
  db = mongoose.connection.db;
  const owner = new mongoose.Types.ObjectId(),
    brand = new mongoose.Types.ObjectId(),
    product = new mongoose.Types.ObjectId();
  await db.collection('users').insertOne({ _id: owner, role: 'merchant', isActive: true });
  await db.collection('brands').insertOne({ _id: brand, ownerId: owner });
  await db.collection('products').insertOne({ _id: product, brand, stock: 7, price: 100000 });
  ids = [];
  for (const value of [undefined, null, false, true, 'legacy-flag']) {
    const row = {
      _id: new mongoose.Types.ObjectId(),
      ownerId: owner,
      products: [{ productId: product }],
      internalSubscription: value === true ? true : false,
    };
    if (value !== undefined) row.subscriptionOnly = value;
    if (value === false) delete row.internalSubscription;
    ids.push(row._id);
    await db.collection('boxes').insertOne(row);
  }
  for (const name of protectedNames)
    await db.collection(name).insertOne({
      _id: new mongoose.Types.ObjectId(),
      run,
      amount: 300007,
      state: name === 'checkoutattempts' ? 'invalidated' : 'fixture',
      ownerId: owner,
    });
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  sourceDb = fixture.client.db(fixture.database);
  sourceSnapshot = await snapshot(sourceDb);
  const clone = fixture.client.db(fixture.database + '_clone');
  expect(await clone.listCollections().toArray()).toEqual([]);
  for (const item of await sourceDb.listCollections().toArray()) {
    await clone.createCollection(item.name, item.options);
    const rows = await sourceDb.collection(item.name).find().toArray();
    if (rows.length) await clone.collection(item.name).insertMany(rows);
  }
  await mongoose.disconnect();
  await mongoose.connect(fixture.uri(clone.databaseName), { autoIndex: false });
  db = mongoose.connection.db;
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  expect(await snapshot(clone)).toEqual(sourceSnapshot);
  write('migration-clone.json', {
    run,
    sourceDatabase: fixture.database,
    cloneDatabase: clone.databaseName,
    identicalDocumentsAndIndexes: true,
    sourceSnapshot,
  });
  original = await hash(['products', 'boxes', ...protectedNames]);
  manifest = await script.plan();
}, 90000);
afterAll(async () => {
  try {
    if (sourceDb && sourceSnapshot) expect(await snapshot(sourceDb)).toEqual(sourceSnapshot);
  } finally {
    await mongoose.disconnect();
    await fixture?.cleanup();
  }
});
test('C1 manifest v2 preserves absent/null/false/value and dry-run is read-only', async () => {
  expect(manifest.version).toBe(2);
  expect(await hash(['products', 'boxes', ...protectedNames])).toBe(original);
  const fields = manifest.changes
    .filter((e) => e.collection === 'boxes')
    .map((e) => e.before.subscriptionOnly)
    .filter(Boolean);
  expect(fields).toEqual(
    expect.arrayContaining([
      { exists: false },
      { exists: true, value: null },
      { exists: true, value: false },
      { exists: true, value: 'legacy-flag' },
    ]),
  );
});
test('C1 refuses legacy and malformed manifests before any write', async () => {
  const ownerChange = manifest.changes.find((e) => e.collection === 'products');
  expect(() =>
    script.validateManifest({
      ...manifest,
      changes: [
        {
          ...ownerChange,
          before: { ownerId: { exists: true, value: String(new mongoose.Types.ObjectId()) } },
        },
      ],
    }),
  ).toThrow(/owner|preimage/i);
  const legacy = { ...manifest };
  delete legacy.version;
  await expect(script.apply(legacy)).rejects.toThrow(/version|legacy/i);
  await expect(
    script.apply({
      ...manifest,
      changes: [
        {
          collection: 'boxes',
          id: String(ids[0]),
          before: { subscriptionOnly: { exists: false } },
          after: { subscriptionOnly: { exists: true, value: { $gt: 0 } } },
        },
      ],
    }),
  ).rejects.toThrow(/manifest|value/i);
  expect(await hash(['products', 'boxes', ...protectedNames])).toBe(original);
});
test('C1 actual child crash after first transactional write leaves clone unchanged; rerun applies', async () => {
  const protectedBefore = await hash(protectedNames);
  const child = fork(require.resolve('./helpers/roundC1/migration-crash'), [], {
    env: { ...process.env, C1_MONGO_URI: fixture.uri(db.databaseName) },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const pid = child.pid;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('C1 crash barrier deadline'));
    }, 30000);
    child.once('error', reject);
    child.once('message', async (message) => {
      if (message.event !== 'first-write-held') return;
      clearTimeout(timer);
      child.once('exit', (code, signal) => {
        write('migration-crash.json', {
          pid,
          exitCode: code,
          signal,
          barrier: message.event,
          exactChildHandle: true,
        });
        resolve();
      });
      child.kill('SIGKILL');
    });
  });
  expect(await hash(['products', 'boxes', ...protectedNames])).toBe(original);
  await script.apply(manifest);
  expect((await script.plan()).changes).toHaveLength(0);
  const applied = await hash(['products', 'boxes', ...protectedNames]);
  await expect(script.apply(manifest)).rejects.toThrow(/CAS/);
  expect(await hash(['products', 'boxes', ...protectedNames])).toBe(applied);
  expect(await hash(protectedNames)).toBe(protectedBefore);
}, 90000);
test('C1 rollback CAS refuses later writer and restores exact physical preimage in safe subset', async () => {
  const product = await db.collection('products').findOne(),
    writer = new mongoose.Types.ObjectId();
  await db.collection('products').updateOne({ _id: product._id }, { $set: { ownerId: writer } });
  const afterWriter = await hash(['products', 'boxes', ...protectedNames]);
  await expect(script.apply(manifest, true)).rejects.toThrow(/CAS/);
  expect(await hash(['products', 'boxes', ...protectedNames])).toBe(afterWriter);
  await script.apply(
    { ...manifest, changes: manifest.changes.filter((e) => e.collection !== 'products') },
    true,
  );
  expect((await db.collection('products').findOne()).ownerId.equals(writer)).toBe(true);
  const rows = await Promise.all(ids.map((_id) => db.collection('boxes').findOne({ _id })));
  expect(Object.hasOwn(rows[0], 'subscriptionOnly')).toBe(false);
  expect(rows[1].subscriptionOnly).toBeNull();
  expect(rows[2].subscriptionOnly).toBe(false);
  expect(rows[3].subscriptionOnly).toBe(true);
  expect(rows[4].subscriptionOnly).toBe('legacy-flag');
  write('migration-verification.json', {
    version: manifest.version,
    manifest,
    physicalPreimageRestored: true,
    writerPreserved: true,
    protectedFingerprint: await hash(protectedNames),
    indexOperations: 0,
  });
});
test('C1 writer assigning owner during dry-run is rejected without planning a transfer', async () => {
  await fixture.assertTarget();
  const protectedBefore = await hash(protectedNames),
    brand = await db.collection('brands').findOne(),
    id = new mongoose.Types.ObjectId(),
    writer = new mongoose.Types.ObjectId();
  await db.collection('products').insertOne({
    _id: id,
    productId: 'C1-writer-' + String(id),
    slug: 'c1-writer-' + String(id),
    brand: brand._id,
    stock: 10,
    price: 100000,
  });
  const collection = mongoose.connection.collection('products'),
    originalFind = collection.findOne.bind(collection);
  let injected = false;
  collection.findOne = async (filter, ...args) => {
    if (!injected && String(filter._id) === String(id)) {
      injected = true;
      const changed = await collection.updateOne(
        { _id: id, ownerId: { $exists: false } },
        { $set: { ownerId: writer } },
      );
      expect(changed.matchedCount).toBe(1);
    }
    return originalFind(filter, ...args);
  };
  try {
    await expect(script.plan()).rejects.toThrow(/Ownership changed during dry-run/);
  } finally {
    collection.findOne = originalFind;
  }
  expect(injected).toBe(true);
  expect((await db.collection('products').findOne({ _id: id })).ownerId.equals(writer)).toBe(true);
  expect(await hash(protectedNames)).toBe(protectedBefore);
  write('migration-dry-run-writer.json', {
    writerPreserved: true,
    transferPlanRefused: true,
    protectedFingerprint: protectedBefore,
  });
});
