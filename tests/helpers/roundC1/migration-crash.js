require('../noDotenv');
const mongoose = require('mongoose');
(async () => {
  if (
    !/^mongodb:\/\/127\.0\.0\.1:\d+\/totmart_c1_migration_[a-f0-9]+(?:_clone)?\?/.test(
      process.env.C1_MONGO_URI,
    )
  )
    throw new Error('C1 owned target required');
  await mongoose.connect(process.env.C1_MONGO_URI);
  const { run } = require('./context');
  const marker = await mongoose.connection.db.collection('c1ownership').findOne({ _id: run });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (marker?.processId !== String(hello.topologyVersion.processId) || !hello.isWritablePrimary)
    throw new Error('C1 crash target identity mismatch');
  const script = require('../../../scripts/migrate-commerce-integrity');
  const plan = await script.plan();
  const collection = mongoose.connection.collection(plan.changes[0].collection),
    original = collection.updateOne.bind(collection);
  collection.updateOne = async (...args) => {
    const result = await original(...args);
    process.send({ event: 'first-write-held' });
    await new Promise(() => {});
    return result;
  };
  await script.apply(plan);
})().catch(() => process.exit(1));
