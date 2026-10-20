const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// checkOutController dùng mongoose.startSession()/withTransaction(), và
// transaction chỉ chạy được trên replica set (không chạy trên mongod standalone),
// nên bắt buộc phải dùng MongoMemoryReplSet chứ không phải MongoMemoryServer thường.
let replSet;
let connected = false;

async function connect(options = {}) {
  if (process.env.TEST_MONGODB_URI) {
    const uri = process.env.TEST_MONGODB_URI;
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/totmart_test(?:\?|$)/.test(uri)) throw new Error('External tests require a local database named totmart_test');
    await mongoose.connect(uri);
    connected = true;
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    return;
  }
  replSet = new MongoMemoryReplSet({
    replSet: { count: 1, storageEngine: "wiredTiger", args: options.mongoArgs || [] },
    binary: { version: process.env.MONGOMS_VERSION || "7.0.14" },
  });
  await replSet.start();
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  connected = true;
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}

async function closeDatabase() {
  try {
    if (connected && mongoose.connection.readyState === 1) {
      try {
        if (process.env.TEST_MONGODB_URI) await clearDatabase();
        else await mongoose.connection.dropDatabase();
      } finally { await mongoose.connection.close(); }
    }
  } finally {
    connected = false;
    const owned = replSet; replSet = undefined;
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

module.exports = { connect, closeDatabase, clearDatabase };
