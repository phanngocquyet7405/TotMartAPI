const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = require('./db');
async function create(User) {
  const target = await db.captureOwnedMemoryTarget();
  const run = randomUUID(),
    name = 'b03_owned_legacy_display_fixture';
  const collection = target.connection.db.collection('users');
  const evidence = {
    run,
    name,
    database: target.database,
    collection: 'users',
    mongoProcessId: target.processId,
    port: target.port,
    created: false,
    cleanupExitCode: null,
  };
  const publish = () => {
    const file =
      process.env.B01_B03_INDEX_RESOURCE_FILE ||
      path.join('artifacts/b01', 'index-fixture-' + run + '.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
  };
  await target.verify();
  if (
    User.db !== target.connection ||
    User.collection.collectionName !== 'users' ||
    (await collection.listIndexes().toArray()).some((index) => index.name === name)
  )
    throw Error('Exact index fixture collection/provenance mismatch');
  await target.connection.db.collection('_ownedIndexFixture').insertOne({
    _id: run,
    processId: target.processId,
    database: target.database,
    collection: 'users',
    name,
  });
  const indexName = await collection.createIndex({ name: 1 }, { unique: true, name });
  if (indexName !== name) throw Error('Unexpected created index name');
  evidence.created = true;
  publish();
  return {
    indexName,
    async cleanup() {
      try {
        await target.verify();
        const marker = await target.connection.db
          .collection('_ownedIndexFixture')
          .findOne({ _id: run });
        const actual = (await collection.listIndexes().toArray()).find(
          (index) => index.name === name,
        );
        if (
          User.db !== target.connection ||
          User.collection.collectionName !== 'users' ||
          marker?.processId !== target.processId ||
          marker?.database !== target.database ||
          marker?.collection !== 'users' ||
          marker?.name !== name ||
          !evidence.created ||
          actual?.name !== name ||
          actual.unique !== true ||
          JSON.stringify(actual.key) !== JSON.stringify({ name: 1 })
        )
          throw Error('Index fixture pre-delete verification failed; refusing deletion');
        evidence.beforeDelete = {
          name: actual.name,
          key: actual.key,
          unique: actual.unique,
          instanceVerified: true,
          databaseVerified: true,
          collectionVerified: true,
          at: Date.now(),
        };
        publish();
        await collection.dropIndex(name);
        evidence.absent = !(await collection.listIndexes().toArray()).some(
          (index) => index.name === name,
        );
        if (!evidence.absent) throw Error('Exact fixture index remains after cleanup');
        evidence.cleanupExitCode = 0;
      } catch (error) {
        evidence.cleanupExitCode = 1;
        throw error;
      } finally {
        publish();
      }
    },
  };
}
module.exports = { create };
