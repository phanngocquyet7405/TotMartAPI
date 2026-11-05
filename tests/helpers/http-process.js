// Disposable integration runner. Never loads server.js schedulers that send external messages.
let startupStage = 'modules';
process.send({ startupStage });
const mongoose = require('mongoose');
const redis = require('../../src/config/redis');
const app = require('../../src/app');
let server, worker;
let releaseCommerceFence;
(async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.MONGODB_URI))
    throw new Error('Local disposable Mongo only');
  startupStage = 'mongo';
  process.send({ startupStage });
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  startupStage = 'redis';
  process.send({ startupStage });
  await redis.startRedis();
  worker = require('../../src/jobs/securityOutboxScheduler').start();
  server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
})().catch(() => {
  process.send({ startupFailed: startupStage });
  process.exit(1);
});
process.on('message', async (message) => {
  if (message === 'arm-commerce-response-loss') {
    const original = app.response.json;
    app.response.json = function (body) {
      if (
        this.statusCode === 201 &&
        ['/api/checkout/check-out', '/api/subcribe-plans/user-subscribe'].includes(
          this.req.originalUrl,
        )
      ) {
        app.response.json = original;
        // Both controllers reach this only after withTransaction resolves.
        this.destroy();
        process.send('commerce-committed-response-dropped');
        return this;
      }
      return original.call(this, body);
    };
    process.send('commerce-response-loss-armed');
    return;
  }
  if (message === 'arm-commerce-fence' || message === 'observe-commerce-fence') {
    const attempts = require('../../src/services/checkoutAttemptService'),
      original = attempts.lock;
    attempts.lock = async (...args) => {
      attempts.lock = original;
      if (message === 'observe-commerce-fence') {
        process.send('commerce-fence-entered');
        return original(...args);
      }
      const result = await original(...args);
      const released = new Promise((resolve) => {
        releaseCommerceFence = resolve;
      });
      process.send('commerce-fence-held');
      await released;
      return result;
    };
    process.send(
      message === 'arm-commerce-fence' ? 'commerce-fence-armed' : 'commerce-observer-armed',
    );
    return;
  }
  if (message === 'release-commerce-fence') {
    releaseCommerceFence?.();
    releaseCommerceFence = undefined;
    process.send('commerce-fence-released');
    return;
  }
  if (message === 'pause-security-worker') {
    clearInterval(worker);
    process.send('security-worker-paused');
    return;
  }
  if (message === 'resume-security-worker') {
    clearInterval(worker);
    worker = require('../../src/jobs/securityOutboxScheduler').start();
    process.send('security-worker-resumed');
    return;
  }
  if (message === 'arm-refresh-response-loss') {
    const sessions = require('../../src/services/sessionService'),
      original = sessions.setCookies;
    sessions.setCookies = (res, ...args) => {
      sessions.setCookies = original;
      // refreshController reaches this only after the rotation transaction commits.
      // Destroy before writing cookies/body; never send credential material via IPC.
      res.destroy();
      process.send('refresh-committed-response-dropped');
    };
    process.send('refresh-response-loss-armed');
    return;
  }
  if (message === 'arm-crash-fence') {
    const attempts = require('../../src/services/checkoutAttemptService'),
      lock = attempts.lock;
    attempts.lock = async (...args) => {
      const result = await lock(...args);
      process.send('transaction-fence-held');
      await new Promise(() => {}); // Test-only barrier: parent kills this process with a live transaction.
      return result;
    };
    process.send('crash-fence-armed');
    return;
  }
  if (message !== 'stop') return;
  clearInterval(worker);
  require('../../src/controllers/notificationController').terminateAllStreams();
  if (server) await new Promise((resolve) => server.close(resolve));
  await redis.stopRedis();
  await mongoose.disconnect();
  process.exit(0);
});
