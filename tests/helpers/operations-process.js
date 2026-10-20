// B07-only child. No runtime control route, provider credential or dotenv load.
const mongoose = require('mongoose');
mongoose.set('bufferTimeoutMS', 2000);
const redis = require('../../src/config/redis');
const app = require('../../src/app');
let server;
let queryCount = 0;
mongoose.set('debug', () => {
  queryCount++;
});
const workers = {
  expiry: () => require('../../src/jobs/orderExpiryScheduler').expireStaleOrders(),
  delivery: () => require('../../src/jobs/deliveryScheduler').processDeliveries(),
  payment: () => require('../../src/jobs/paymentReconciliationScheduler').drain(),
  notification: () => require('../../src/jobs/notificationOutboxScheduler').drain(),
  security: () => require('../../src/jobs/securityOutboxScheduler').drain(),
};
(async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/totmart_b07_[a-z0-9_]+\?/.test(process.env.MONGODB_URI))
    throw new Error('B07 owned target required');
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 2000,
    socketTimeoutMS: 3000,
    heartbeatFrequencyMS: 500,
    monitorCommands: true,
  });
  mongoose.connection.getClient().on('commandFailed', (event) => {
    if (
      event.commandName === 'commitTransaction' &&
      event.failure?.errorLabels?.includes('UnknownTransactionCommitResult')
    )
      process.send({ event: 'mongo-unknown-commit-observed' });
  });
  await redis.startRedis();
  server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
})().catch(() => {
  process.send({ startupFailed: true });
  process.exit(1);
});
process.on('message', async (message) => {
  const { id, action, worker } = message;
  try {
    if (action === 'metrics') {
      process.send({ id, ok: true, metrics: { queries: queryCount } });
      queryCount = 0;
      return;
    }
    if (action === 'stop') {
      require('../../src/controllers/notificationController').terminateAllStreams();
      await new Promise((resolve) => server.close(resolve));
      await redis.stopRedis();
      await mongoose.disconnect();
      process.exit(0);
    }
    if (action === 'hold-notification-claim') {
      const Model = require('../../src/models/NotificationOutbox'),
        original = Model.findOneAndUpdate;
      Model.findOneAndUpdate = async (...args) => {
        const event = await original.apply(Model, args);
        if (event) {
          Model.findOneAndUpdate = original;
          process.send({ event: 'notification-claim-held' });
          await new Promise(() => {});
        }
        return event;
      };
    } else if (action === 'hold-security-after-publish') {
      const original = redis.getClient;
      redis.getClient = () => {
        const client = original();
        return {
          ...client,
          publish: async (...args) => {
            redis.getClient = original;
            const result = await client.publish(...args);
            process.send({ event: 'security-published-before-marker' });
            await new Promise(() => {});
            return result;
          },
        };
      };
    } else if (action === 'fail-payment-once') {
      const Model = require('../../src/models/PaymentAllocation'),
        original = Model.create;
      Model.create = async () => {
        Model.create = original;
        throw Object.assign(new Error('B07 controlled allocation failure'), { statusCode: 503 });
      };
    } else if (action === 'fail-expiry-write-once') {
      const prototype = require('../../src/models/Order').prototype,
        original = prototype.save;
      prototype.save = async function (...args) {
        prototype.save = original;
        await original.apply(this, args);
        throw new Error('B07 expiry write interruption');
      };
    } else if (action === 'fail-delivery-after-upsert') {
      const Model = require('../../src/models/SubscriptionFulfillment'),
        original = Model.updateOne;
      Model.updateOne = async function (...args) {
        Model.updateOne = original;
        await original.apply(this, args);
        throw new Error('B07 fulfillment upsert acknowledgement loss');
      };
    } else if (action === 'fail-notification-publish-once') {
      const original = redis.getClient;
      redis.getClient = () => ({
        ...original(),
        publish: async () => {
          redis.getClient = original;
          throw new Error('B07 controlled notification transport failure');
        },
      });
    } else if (action === 'drain') {
      if (!workers[worker]) throw new Error('Unsupported worker');
      await workers[worker]();
    } else throw new Error('Unsupported fixture command');
    process.send({ id, ok: true });
  } catch {
    process.send({ id, ok: false });
  }
});
