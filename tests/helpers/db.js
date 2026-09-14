const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// checkOutController dùng mongoose.startSession()/withTransaction(), và
// transaction chỉ chạy được trên replica set (không chạy trên mongod standalone),
// nên bắt buộc phải dùng MongoMemoryReplSet chứ không phải MongoMemoryServer thường.
let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
}

async function closeDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (replSet) {
    await replSet.stop();
  }
}

async function clearDatabase() {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

module.exports = { connect, closeDatabase, clearDatabase };
