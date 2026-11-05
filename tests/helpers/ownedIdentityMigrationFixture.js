// Owner-approved exception for exactly two identityMigrationB03 indexes.
// Interpose only in this test; the migration script remains unchanged.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Collection } = require('mongoose').mongo;
const { withDisposableIdentityDb } = require('../../scripts/review-user-identity');

async function withGuardedIdentityDb(work) {
  return withDisposableIdentityDb(async (db) => {
    const client = db.client;
    const hosts = client.options.hosts.map((host) => ({ host: host.host, port: host.port }));
    const hello = await db.admin().command({ hello: 1 });
    if (
      hosts.length !== 1 ||
      !['127.0.0.1', 'localhost'].includes(hosts[0].host) ||
      !Number.isInteger(hosts[0].port) ||
      !hello.isWritablePrimary ||
      !hello.setName ||
      db.databaseName !== 'totmart_test' ||
      !hello.topologyVersion?.processId
    )
      throw Error('Disposable identity binding verification failed');
    const processId = String(hello.topologyVersion.processId);
    const run = randomUUID();
    const marker = { _id: run, processId, database: db.databaseName, collection: 'users', hosts };
    await db.collection('_ownedIdentityMigration').insertOne(marker);
    const evidence = {
      run,
      processId,
      database: db.databaseName,
      collection: 'users',
      hosts,
      drops: [],
    };
    const directory = process.env.B01_B03_INDEX_RESOURCE_FILE
      ? path.dirname(process.env.B01_B03_INDEX_RESOURCE_FILE)
      : 'artifacts/b01';
    const publish = () => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'identity-migration-' + run + '.json'),
        JSON.stringify(evidence, null, 2),
      );
    };
    const original = Collection.prototype.dropIndex;
    const spy = jest
      .spyOn(Collection.prototype, 'dropIndex')
      .mockImplementation(async function (name, options) {
        const expected = {
          legacy_custom_display: { name: 1 },
          custom_display_desc: { name: -1 },
        }[name];
        const currentHello = await db.admin().command({ hello: 1 });
        const actualMarker = await db.collection('_ownedIdentityMigration').findOne({ _id: run });
        const actual = (await this.listIndexes().toArray()).find((index) => index.name === name);
        if (
          !expected ||
          this.client !== client ||
          db.client !== client ||
          this.dbName !== marker.database ||
          this.collectionName !== 'users' ||
          JSON.stringify(
            client.options.hosts.map((host) => ({ host: host.host, port: host.port })),
          ) !== JSON.stringify(hosts) ||
          String(currentHello.topologyVersion?.processId) !== processId ||
          !currentHello.isWritablePrimary ||
          JSON.stringify(actualMarker) !== JSON.stringify(marker) ||
          actual?.name !== name ||
          actual.unique !== true ||
          JSON.stringify(actual.key) !== JSON.stringify(expected) ||
          (name === 'custom_display_desc' && actual.sparse !== true)
        )
          throw Error('Identity index pre-drop verification failed; refusing drop');
        const row = {
          name,
          key: actual.key,
          unique: actual.unique,
          sparse: actual.sparse === true,
          sameClient: true,
          instanceVerified: true,
          databaseVerified: true,
          collectionVerified: true,
          markerVerified: true,
          beforeDropAt: Date.now(),
        };
        evidence.drops.push(row);
        publish();
        const result = await original.call(this, name, options);
        row.absent = !(await this.listIndexes().toArray()).some((index) => index.name === name);
        publish();
        if (!row.absent) throw Error('Exact identity fixture index remains after drop');
        return result;
      });
    try {
      return await work(db);
    } finally {
      spy.mockRestore();
      publish();
    }
  });
}
module.exports = { withGuardedIdentityDb };
