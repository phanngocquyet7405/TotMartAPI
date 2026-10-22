// Test-only preload. A server-injected duplicate insert error enters the real
// prepare catch branch; the following real Mongo read is the only timed fault.
require('./mongo-observer');
const fs = require('node:fs');
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const mongoose = require('/app/node_modules/mongoose');
const context = new AsyncLocalStorage();
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event !== 'request') return emit.call(this, event, ...args);
  return context.run({ enabled: args[0].headers['x-fixture-a1-duplicate'] === '1', reads: 0 }, () =>
    emit.call(this, event, ...args),
  );
};
const exec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = async function (...args) {
  const state = context.getStore();
  if (
    state?.enabled &&
    this.model.modelName === 'CheckoutAttempt' &&
    this.op === 'findOne' &&
    !this.getOptions().session &&
    ++state.reads === 2
  ) {
    const control = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
      appName: 'totmart-fixture-duplicate-control',
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    await control.connect();
    try {
      const point = await control.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: {
          failCommands: ['find'],
          appName: 'totmart-fixture-production',
          namespace: mongoose.connection.name + '.checkoutattempts',
          blockConnection: true,
          blockTimeMS: 20000,
        },
      });
      fs.writeFileSync(
        '/fixture/a1-duplicate-barrier.json',
        JSON.stringify({ at: Date.now(), count: point.count }),
      );
    } finally {
      await control.close();
    }
  }
  return exec.apply(this, args);
};
