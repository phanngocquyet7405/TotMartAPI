// Only the executable entrypoint loads local .env; tests preload noDotenv.
require('dotenv').config();
const config = require('./config/environment');
require('./config/resolveEnvironment').assertServerConfig(config);
const app = require('./app');
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
if (config.envWarnings && config.envWarnings.length) {
  for (const warning of config.envWarnings) {
    logger.warn({ event: 'env_warning', warning }, warning);
  }
}
const { startDeliveryScheduler } = require('./jobs/deliveryScheduler');
const { startOrderExpiryScheduler } = require('./jobs/orderExpiryScheduler');

async function assertPaymentLedgerReady() {
  if (
    (await require('./models/Checkout').exists({
      paymentLedgerVersion: { $exists: false },
    })) ||
    (await require('./models/PaymentEvent').exists({
      paymentLedgerVersion: { $exists: false },
    }))
  ) {
    throw new Error('Run and review payment-ledger migration before accepting traffic');
  }
  if (config.nodeEnv === 'production') {
    const legacyOpen = await require('./models/Checkout').exists({
      paymentLedgerVersion: 1,
      state: 'pending',
    });
    const legacyReceipts = await require('./models/PaymentEvent').exists({
      paymentLedgerVersion: 1,
      state: { $ne: 'processed' },
    });
    if (legacyOpen || legacyReceipts)
      throw new Error(
        'Unresolved legacy money requires reviewed bank reconciliation before production',
      );
  }
}

async function prepareCollectionsIndexesAndTopology() {
  require('./models/AuthSession');
  require('./models/SecurityOutbox');
  // Do not accept checkouts before the unique indexes and collections exist.
  // Index errors (including legacy duplicates) must fail startup visibly.
  const tModelInit = performance.now();
  await Promise.all(Object.values(require('mongoose').models).map((model) => model.init()));
  logger.info(
    {
      event: 'startup_phase',
      phase: 'model.init',
      ms: Math.round(performance.now() - tModelInit),
    },
    'Models initialization completed',
  );

  // Explicit createIndexes is additive; never drop indexes during startup.
  const tCreateIndexes = performance.now();
  for (const model of Object.values(require('mongoose').models)) await model.createIndexes();
  logger.info(
    {
      event: 'startup_phase',
      phase: 'createIndexes',
      ms: Math.round(performance.now() - tCreateIndexes),
    },
    'Indexes creation completed',
  );

  const tTopology = performance.now();
  const topology = await require('mongoose').connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid')
    throw new Error('MongoDB transactions require replica set or sharded topology');
  logger.info(
    {
      event: 'startup_phase',
      phase: 'checkTopology',
      ms: Math.round(performance.now() - tTopology),
    },
    'Topology check completed',
  );
}

function startWorkers(workers) {
  workers.push(
    require('./jobs/paymentReconciliationScheduler').start(),
    startDeliveryScheduler(),
    startOrderExpiryScheduler(),
    require('./jobs/notificationOutboxScheduler').start(),
    require('./jobs/securityOutboxScheduler').start(),
  );
}

const server = async () => {
  const startupStart = performance.now();
  try {
    const tConnectDB = performance.now();
    await connectDB();
    logger.info(
      {
        event: 'startup_phase',
        phase: 'connectDB',
        ms: Math.round(performance.now() - tConnectDB),
      },
      'Database connection established',
    );

    const tLedger = performance.now();
    await assertPaymentLedgerReady();
    logger.info(
      {
        event: 'startup_phase',
        phase: 'assertPaymentLedgerReady',
        ms: Math.round(performance.now() - tLedger),
      },
      'Payment ledger verification completed',
    );

    await prepareCollectionsIndexesAndTopology();

    const tRedis = performance.now();
    await require('./config/redis').startRedis();
    logger.info(
      {
        event: 'startup_phase',
        phase: 'startRedis',
        ms: Math.round(performance.now() - tRedis),
      },
      'Redis startup completed',
    );

    const workers = [];
    const PORT = config.port;
    const httpServer = app.listen(PORT, () => {
      const portOpenMs = Math.round(performance.now() - startupStart);
      logger.info(
        {
          event: 'startup_phase',
          phase: 'portOpen',
          ms: portOpenMs,
        },
        `Server running on http://localhost:${PORT}/api/home/health`,
      );
      logger.info(`Environment: ${config.nodeEnv}`);

      startWorkers(workers);
    });

    httpServer.workers = workers;
    return httpServer;
  } catch (error) {
    logger.error({ event: 'server_start_failed', type: error.name }, 'Failed to start server');
    process.exit(1);
  }
};

function gracefulShutdown(httpServer, reason, error) {
  const exitCode = ['SIGTERM', 'SIGINT'].includes(reason) ? 0 : 1;
  require('./controllers/healthController').setStopping(true);
  require('./controllers/notificationController').terminateAllStreams();
  for (const worker of httpServer?.workers || []) {
    if (worker?.stop) worker.stop();
    else clearInterval(worker);
  }
  logger.error({ err: error }, `[${reason}] Server đang tắt...`);
  if (!httpServer) {
    process.exit(exitCode);
    return;
  }

  const forceExitTimer = setTimeout(() => {
    logger.error('Đóng server quá thời gian cho phép, buộc thoát.');
    process.exit(exitCode);
  }, 10_000);
  forceExitTimer.unref();

  httpServer.close(async () => {
    try {
      const { disconnectDB } = require('./config/database');
      await require('./config/redis').stopRedis();
      await disconnectDB();
    } catch (closeErr) {
      logger.error({ err: closeErr }, 'Lỗi khi đóng kết nối DB');
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    }
  });
}

server().then((httpServer) => {
  process.on('unhandledRejection', (error) => {
    gracefulShutdown(httpServer, 'Unhandled Rejection', error);
  });

  process.on('uncaughtException', (error) => {
    gracefulShutdown(httpServer, 'Uncaught Exception', error);
  });

  process.on('SIGINT', () => gracefulShutdown(httpServer, 'SIGINT'));
  process.on('SIGTERM', () => {
    logger.info('Nhận SIGTERM, đang tắt server...');
    gracefulShutdown(httpServer, 'SIGTERM');
  });
});
