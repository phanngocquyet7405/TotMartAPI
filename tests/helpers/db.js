const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// checkOutController dùng mongoose.startSession()/withTransaction(), và
// transaction chỉ chạy được trên replica set (không chạy trên mongod standalone),
// nên bắt buộc phải dùng MongoMemoryReplSet chứ không phải MongoMemoryServer thường.
let replSet;
let connected = false;

async function connect(options = {}) {
  if (process.env.TEST_MONGODB_URI) {
    const uri = process.env.TEST_MONGODB_URI;
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/totmart_test(?:\?|$)/.test(uri))
      throw new Error('External tests require a local database named totmart_test');
    await mongoose.connect(uri);
    connected = true;
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    return;
  }
  replSet = new MongoMemoryReplSet({
    replSet: { count: 1, storageEngine: 'wiredTiger', args: options.mongoArgs || [] },
    binary: { version: process.env.MONGOMS_VERSION || '7.0.14' },
  });
  await replSet.start();
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  connected = true;
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function closeDatabase() {
  try {
    if (connected && mongoose.connection.readyState === 1) {
      try {
        if (process.env.TEST_MONGODB_URI) await clearDatabase();
        else await mongoose.connection.dropDatabase();
      } finally {
        await mongoose.connection.close();
      }
    }
  } finally {
    connected = false;
    const owned = replSet;
    replSet = undefined;
    if (owned) await owned.stop();
  }
}

async function clearDatabase() {
  if (!connected || mongoose.connection.readyState !== 1) return;
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

async function captureOwnedMemoryTarget() {
  if (
    !replSet ||
    !connected ||
    process.env.TEST_MONGODB_URI ||
    mongoose.connection.readyState !== 1
  )
    throw new Error('Index fixture requires this invocation owned MongoMemoryReplSet');
  const connection = mongoose.connection,
    client = connection.getClient(),
    owned = replSet;
  const address = new URL(owned.getUri());
  if (
    !['127.0.0.1', 'localhost'].includes(address.hostname) ||
    connection.port !== Number(address.port) ||
    connection.host !== address.hostname
  )
    throw new Error('Owned Mongo instance binding mismatch');
  const database = connection.name;
  const processId = String(
    (await connection.db.admin().command({ hello: 1 })).topologyVersion.processId,
  );
  return {
    connection,
    database,
    processId,
    port: Number(address.port),
    async verify() {
      if (
        replSet !== owned ||
        mongoose.connection !== connection ||
        connection.getClient() !== client ||
        !connected ||
        connection.readyState !== 1 ||
        connection.name !== database ||
        connection.port !== Number(address.port) ||
        process.env.TEST_MONGODB_URI
      )
        throw new Error('Index fixture database/instance ownership changed');
      if (
        String((await connection.db.admin().command({ hello: 1 })).topologyVersion.processId) !==
        processId
      )
        throw new Error('Index fixture Mongo process identity changed');
    },
  };
}
module.exports = { connect, closeDatabase, clearDatabase, captureOwnedMemoryTarget };
