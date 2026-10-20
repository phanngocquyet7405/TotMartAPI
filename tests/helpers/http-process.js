// Disposable integration runner. Never loads server.js schedulers that send external messages.
let startupStage = 'modules';
process.send({ startupStage });
const mongoose = require('mongoose');
const redis = require('../../src/config/redis');
const app = require('../../src/app');
let server, worker;
(async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.MONGODB_URI)) throw new Error('Local disposable Mongo only');
  startupStage = 'mongo'; process.send({ startupStage });
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  startupStage = 'redis'; process.send({ startupStage });
  await redis.startRedis();
  worker = require('../../src/jobs/securityOutboxScheduler').start();
  server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
})().catch(() => { process.send({ startupFailed: startupStage }); process.exit(1); });
process.on('message', async message => {
  if (message === 'arm-crash-fence') {
    const attempts = require('../../src/services/checkoutAttemptService'), lock = attempts.lock;
    attempts.lock = async (...args) => {
      const result = await lock(...args);
      process.send('transaction-fence-held');
      await new Promise(() => {}); // Test-only barrier: parent kills this process with a live transaction.
      return result;
    };
    process.send('crash-fence-armed'); return;
  }
  if (message !== 'stop') return;
  clearInterval(worker);
  require('../../src/controllers/notificationController').terminateAllStreams();
  if (server) await new Promise(resolve => server.close(resolve));
  await redis.stopRedis(); await mongoose.disconnect(); process.exit(0);
});
