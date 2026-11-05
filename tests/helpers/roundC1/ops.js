require('../noDotenv');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const { root, run, write, sha, docker, mongo, wait } = require('./context');
const { disposableRedis } = require('../disposableRedis');
const { BSON } = mongoose.mongo;
const fingerprint = (rows) => sha(BSON.EJSON.stringify(rows));
(async () => {
  let fixture, redis, server, sink, watchdogChild;
  const report = { run, scenarios: [], exitCode: null };
  try {
    fixture = await mongo('ops');
    await fixture.assertTarget();
    redis = await disposableRedis({
      purpose: 'c1',
      onEvidence: (value) => write('resources-ops-redis.json', value),
    });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '1d',
      SEPAY_API_KEY: randomBytes(24).toString('hex'),
      SEPAY_BANK_ACCOUNT: '0123456789',
      SEPAY_BANK_NAME: 'FixtureBank',
      FRONTEND_URL: 'http://localhost:3001',
      CORS_ORIGINS: 'http://localhost:3001',
      TRUST_PROXY: '0',
      BCRYPT_COST: '12',
      REDIS_URL: redis.url,
      REDIS_NAMESPACE: 'c1:' + run,
    });
    const app = require('../../../src/app'),
      redisClient = require('../../../src/config/redis');
    await mongoose.connect(fixture.uri(fixture.database));
    await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
    await redisClient.startRedis();
    const f = require('../factories');
    const { user } = await f.createUser(),
      { user: admin } = await f.createUser({ role: 'admin' }),
      brand = await f.createBrand(),
      product = await f.createProduct(brand, { stock: 100 }),
      coupon = await f.createCoupon({ discountType: 'fixed', discount: 1 });
    const session = require('../../../src/services/sessionService');
    const token = await session.createSession(user, { cookie() {}, clearCookie() {} }),
      adminToken = await session.createSession(admin, { cookie() {}, clearCookie() {} });
    let serverPort;
    async function listen() {
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      serverPort = server.address().port;
    }
    async function close() {
      if (server) {
        await new Promise((r) => server.close(r));
        server = null;
      }
    }
    await listen();
    async function call(url, body, key, access = token) {
      const res = await fetch(`http://127.0.0.1:${serverPort}` + url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + access,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      return { status: res.status, body: await res.json() };
    }
    async function pay(code, amount, id) {
      const res = await fetch(
        `http://127.0.0.1:${server.address().port}/api/checkout/sepay-webhook`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Apikey ' + process.env.SEPAY_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id,
            gateway: 'FixtureBank',
            transactionDate: '2026-10-22 00:00:00',
            accountNumber: '0123456789',
            code,
            content: code,
            transferType: 'in',
            transferAmount: amount,
            referenceCode: 'C1-' + id,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const status = res.status;
      await res.arrayBuffer();
      assert.equal(status, 200);
    }
    await f.createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const body = {
        addressId: String(user.addresses[0]._id),
        paymentMethod: 'online',
        couponCode: coupon.code,
      },
      key = 'c1-backup-products-key';
    const created = await call('/api/checkout/check-out', body, key);
    assert.equal(created.status, 201);
    const Checkout = require('../../../src/models/Checkout'),
      Attempt = require('../../../src/models/CheckoutAttempt');
    const checkout = await Checkout.findOne({ requestKey: key });
    await pay(checkout.paymentCode, 40000, 910001);
    await pay(checkout.paymentCode, checkout.totalAmount + 7 - 40000, 910002);
    const Box = require('../../../src/models/Box'),
      Template = require('../../../src/models/SubscriptionTemplate');
    const box = await Box.create({
      ownerId: brand.ownerId,
      name: 'C1 synthetic box',
      descriptions: 'Fixture',
      stock: 20,
      value: 100000,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 86400000),
      products: [{ productId: product._id, quantity: 1, price: 100000, name: 'Fixture part' }],
    });
    const template = await Template.create({
      ownerId: brand.ownerId,
      name: 'C1 subscription',
      boxId: box._id,
      planType: '3_month',
      basePrice: 300000,
      discountPrice: 300000,
    });
    const subBody = {
        templateId: String(template._id),
        shippingAddress: user.addresses[0].toObject(),
      },
      subKey = 'c1-backup-subscription-key';
    const subscribed = await call('/api/subcribe-plans/user-subscribe', subBody, subKey);
    assert.equal(subscribed.status, 201);
    await pay(subscribed.body.data.orderCode, 100001, 910003);
    await pay(subscribed.body.data.orderCode, 200006, 910004);
    const tombstone = 'c1-backup-tombstone-key';
    const terminated = await call(
      `/api/checkout/attempts/products/${tombstone}/terminate-with-body`,
      body,
    );
    assert.equal(terminated.status, 200);
    assert.equal(terminated.body.data.state, 'invalidated');

    // Actual authenticated summary -> adapter -> loopback-only sink. No business worker/provider runs.
    const sentinel = {
      _id: new mongoose.Types.ObjectId(),
      state: 'pending',
      createdAt: new Date(Date.now() - 2 * 86400000),
      c1Run: run,
    };
    const modelOutbox = require('../../../src/models/NotificationOutbox');
    const alertsCollection = mongoose.connection.db.collection(modelOutbox.collection.name);
    await alertsCollection.insertOne(sentinel);
    const deliveries = [],
      seen = new Set(),
      attempts = new Map();
    let rejectAll = true,
      loseAck = true;
    sink = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const k = req.headers['idempotency-key'];
        attempts.set(k, (attempts.get(k) || 0) + 1);
        if (rejectAll) {
          res.writeHead(503).end();
          return;
        }
        if (!seen.has(k)) {
          seen.add(k);
          deliveries.push({ key: k, payload: JSON.parse(raw) });
        }
        if (loseAck) {
          loseAck = false;
          res.writeHead(503).end();
          return;
        }
        res.writeHead(204).end();
      });
    });
    await new Promise((r) => sink.listen(0, '127.0.0.1', r));
    const sinkUrl = `http://127.0.0.1:${sink.address().port}`,
      stateFile = path.join(root, 'alert-state.json');
    const {
      createDispatcher,
      httpDelivery,
    } = require('../../../scripts/dispatch-operations-alerts');
    let lastSummaryAt = 0;
    const readSummary = async () => {
      const response = await call(
        '/api/admin/operations/health-summary',
        undefined,
        undefined,
        adminToken,
      );
      assert.equal(response.status, 200);
      lastSummaryAt = Date.now();
      write('alert-heartbeat-' + process.env.C1_ATTEMPT + '.json', { run, lastSummaryAt });
      write('alert-summary.json', response.body.data);
      return response.body.data;
    };
    const save = async (state) => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    let dispatcher = createDispatcher({ readSummary, deliver: httpDelivery(sinkUrl), save });
    const failed = await dispatcher.tick();
    assert(failed.failed > 0);
    assert.equal(failed.deliveryHealthy, false);
    const persisted = JSON.parse(fs.readFileSync(stateFile));
    assert(Object.values(persisted).some((s) => s.pending && s.deliveryFailed));
    rejectAll = false;
    dispatcher = createDispatcher({
      readSummary,
      deliver: httpDelivery(sinkUrl),
      save,
      state: JSON.parse(fs.readFileSync(stateFile)),
    });
    await dispatcher.tick();
    await dispatcher.tick();
    assert.equal((await dispatcher.tick()).sent, 0);
    assert(
      deliveries.some(
        (d) => d.payload.queue === 'notificationOutbox' && d.payload.status === 'firing',
      ),
    );
    assert([...attempts.values()].some((n) => n >= 3));
    await fixture.assertTarget();
    const resolved = await alertsCollection.updateOne(
      { _id: sentinel._id, c1Run: run, state: 'pending' },
      { $set: { state: 'delivered' } },
    );
    assert.equal(resolved.matchedCount, 1);
    await dispatcher.tick();
    assert(
      deliveries.some(
        (d) => d.payload.queue === 'notificationOutbox' && d.payload.status === 'recovery',
      ),
    );
    for (const d of deliveries)
      assert.deepEqual(Object.keys(d.payload).sort(), ['count', 'observedAt', 'queue', 'status']);
    // A separate child observes durable source heartbeats while the summary listener is unavailable.
    await readSummary();
    watchdogChild = fork(require.resolve('./watchdog'), [], {
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        C1_DIRECTORY: root,
        C1_ATTEMPT: process.env.C1_ATTEMPT,
        C1_WATCHDOG_SINK: sinkUrl,
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('C1 watchdog ready deadline')), 5000);
      watchdogChild.once('message', () => {
        clearTimeout(timer);
        resolve();
      });
      watchdogChild.once('error', reject);
    });
    await close();
    const stateBefore = sha(fs.readFileSync(stateFile));
    let sourceFailureCode;
    try {
      await dispatcher.tick();
    } catch (error) {
      sourceFailureCode = error.cause?.code;
      write('source-failure.json', {
        name: error.name,
        code: error.code,
        causeName: error.cause?.name,
        causeCode: error.cause?.code,
        nestedCodes: error.cause?.errors?.map((e) => e.code),
        sourcePort: serverPort,
      });
    }
    assert(
      ['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(sourceFailureCode),
      'C1 must observe actual summary transport failure',
    );
    assert.equal(sha(fs.readFileSync(stateFile)), stateBefore);
    const watchdogFile = path.join(root, 'watchdog-state-' + process.env.C1_ATTEMPT + '.json');
    async function awaitWatchdog(status) {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (fs.existsSync(watchdogFile)) {
          const state = JSON.parse(fs.readFileSync(watchdogFile));
          if (state.status === status && !state.pending) return state;
        }
        await wait(50);
      }
      throw new Error('C1 independent watchdog transition deadline');
    }
    const watchdog = await awaitWatchdog('firing');
    assert.notEqual(watchdog.pid, process.pid);
    assert.equal(watchdog.run, run);
    assert(Date.now() - lastSummaryAt >= watchdog.thresholdMs);
    assert(deliveries.some((d) => d.payload.queue === 'deadMan' && d.payload.status === 'firing'));
    await listen();
    await readSummary();
    const watchdogRecovery = await awaitWatchdog('recovery');
    assert(
      deliveries.some((d) => d.payload.queue === 'deadMan' && d.payload.status === 'recovery'),
    );
    write('watchdog-state.json', {
      firing: watchdog,
      recovery: watchdogRecovery,
      scope: 'Independent fixture child; no production wiring',
    });
    const watcherExit = new Promise((resolve) =>
      watchdogChild.once('exit', (code, signal) => {
        write('watchdog-exit.json', { run, pid: watchdogChild.pid, exitCode: code, signal });
        resolve(code);
      }),
    );
    watchdogChild.send({ stop: true });
    assert.equal(await watcherExit, 0);
    watchdogChild = null;
    write('alerts.json', {
      run,
      failedDelivery: true,
      pendingPersistedBeforeDelivery: true,
      restartedFromDisk: true,
      lostAckRetriedWithSameKey: true,
      dedup: true,
      sourceFailureObserved: true,
      sourceFailureCode,
      sourceFailureDoesNotEmitRecovery: true,
      externalWatchdog: watchdog,
      externalWatchdogRecovery: true,
      deliveries,
      attempts: Object.fromEntries(attempts),
      productionDeadManWiring: false,
      missingAcceptedRiskSignals: [
        'purchase route latency/p99',
        'in-flight purchase requests',
        'sustained readiness not_ready',
        'unresolved attempt age',
      ],
      exitCode: 0,
    });
    report.scenarios.push({
      name: '8b actual summary, persisted adapter, local sink and external watchdog',
      status: 'pass',
      limitations: 'No production scheduler/on-call/SLO; no native adapter dead-man',
    });

    // The alert-only sentinel is not a business notification; exclude it from the backup fixture.
    await fixture.assertTarget();
    const removedSentinel = await alertsCollection.deleteOne({
      _id: sentinel._id,
      c1Run: run,
      state: 'delivered',
    });
    assert.equal(removedSentinel.deletedCount, 1);

    await close(); // All HTTP writers stopped; no scheduler was started in this fixture.
    const source = mongoose.connection.db,
      markerTime = new Date(),
      markerId = new mongoose.Types.ObjectId();
    await source
      .collection('c1markers')
      .insertOne({ _id: markerId, run, sequence: 1, acknowledgedAt: markerTime, quiesced: true });
    async function inventory(db) {
      const data = {};
      for (const c of await db.listCollections().toArray()) {
        data[c.name] = {
          count: await db.collection(c.name).countDocuments(),
          options: c.options,
          indexes: (await db.collection(c.name).indexes())
            .map((i) => ({ ...i, key: Object.entries(i.key) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          fingerprint: fingerprint(await db.collection(c.name).find().sort({ _id: 1 }).toArray()),
        };
      }
      return data;
    }
    const sourceInventory = await inventory(source);
    write('backup-source-inventory.json', sourceInventory);
    await fixture.assertTarget();
    const dumpStart = Date.now();
    docker([
      'exec',
      fixture.resource.id,
      'mongodump',
      '--host',
      'localhost:27017',
      '--db',
      fixture.database,
      '--archive=/archive/c1.archive.gz',
      '--gzip',
    ]);
    const archive = path.join(root, 'c1-fixture.archive.gz');
    docker(['cp', `${fixture.resource.id}:/archive/c1.archive.gz`, archive]);
    const dumpMs = Date.now() - dumpStart,
      hostBefore = sha(fs.readFileSync(archive));
    const dumpContainerHash = docker([
      'exec',
      fixture.resource.id,
      'sha256sum',
      '/archive/c1.archive.gz',
    ]).split(/\s+/)[0];
    assert.equal(dumpContainerHash, hostBefore);
    assert.deepEqual(
      await inventory(source),
      sourceInventory,
      'Writer changed quiesced source during dump',
    );
    const destination = fixture.database + '_restored',
      restored = fixture.client.db(destination);
    assert.deepEqual(await restored.listCollections().toArray(), []);
    const restoreStart = Date.now();
    docker(['cp', archive, `${fixture.resource.id}:/archive/retained.archive.gz`]);
    const containerBefore = docker([
      'exec',
      fixture.resource.id,
      'sha256sum',
      '/archive/retained.archive.gz',
    ]).split(/\s+/)[0];
    assert.equal(containerBefore, hostBefore);
    await fixture.assertTarget();
    docker([
      'exec',
      fixture.resource.id,
      'mongorestore',
      '--host',
      'localhost:27017',
      '--archive=/archive/retained.archive.gz',
      '--gzip',
      `--nsFrom=${fixture.database}.*`,
      `--nsTo=${destination}.*`,
    ]);
    const restoreMs = Date.now() - restoreStart,
      hostAfter = sha(fs.readFileSync(archive)),
      containerAfter = docker([
        'exec',
        fixture.resource.id,
        'sha256sum',
        '/archive/retained.archive.gz',
      ]).split(/\s+/)[0];
    assert.equal(hostAfter, hostBefore);
    assert.equal(containerAfter, hostBefore);
    const restoredInventory = await inventory(restored);
    assert.deepEqual(restoredInventory, sourceInventory);
    write('backup-restored-inventory.json', restoredInventory);
    const events = await restored
        .collection('paymentevents')
        .find({ paymentLedgerVersion: 2 })
        .toArray(),
      allocations = await restored.collection('paymentallocations').find().toArray(),
      refunds = await restored.collection('receiptrefunds').find().toArray();
    const direct = events.filter((e) =>
      ['refund_pending', 'refunded', 'unallocated'].includes(e.disposition),
    );
    assert.equal(
      events.reduce((s, e) => s + e.transferAmount, 0),
      allocations.reduce((s, a) => s + a.amount, 0) +
        direct.reduce((s, e) => s + e.transferAmount, 0),
    );
    for (const c of await restored.collection('checkouts').find().toArray()) {
      assert.equal(
        allocations.filter((a) => a.checkoutId.equals(c._id)).reduce((s, a) => s + a.amount, 0),
        c.receivedAmount,
      );
      assert.equal(
        c.totalAmount +
          refunds.filter((r) => r.checkoutId?.equals(c._id)).reduce((s, r) => s + r.amount, 0),
        c.receivedAmount,
      );
      assert.equal(await restored.collection('users').countDocuments({ _id: c.userId }), 1);
      if (c.orderIds?.length)
        assert.equal(
          await restored
            .collection('orders')
            .countDocuments({ _id: { $in: c.orderIds }, userId: c.userId }),
          c.orderIds.length,
        );
      if (c.subscriptionId) {
        const sub = await restored
          .collection('usersubscriptions')
          .findOne({ _id: c.subscriptionId });
        assert(sub);
        assert.equal(
          await restored
            .collection('boxversions')
            .countDocuments({ _id: sub.boxVersionId, boxId: sub.boxId }),
          1,
        );
      }
    }
    assert.equal(
      await restored.collection('c1markers').countDocuments({ _id: markerId, run, sequence: 1 }),
      1,
    );
    await mongoose.disconnect();
    await mongoose.connect(fixture.uri(destination), { autoIndex: false });
    await listen();
    const replay = await call('/api/checkout/check-out', body, key);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body.data, created.body.data);
    const replaySub = await call('/api/subcribe-plans/user-subscribe', subBody, subKey);
    assert.equal(replaySub.status, 201);
    assert.deepEqual(replaySub.body.data, subscribed.body.data);
    assert.equal((await call('/api/users/me')).status, 200);
    assert.equal(
      (await call(`/api/checkout/attempts/products/${tombstone}/terminate-with-body`, body)).body
        .data.state,
      'invalidated',
    );
    assert.equal(await Checkout.countDocuments({ requestKey: key }), 1);
    assert.equal(await Checkout.countDocuments({ requestKey: subKey }), 1);
    assert.equal(await Attempt.countDocuments({ key: tombstone, state: 'invalidated' }), 1);
    const observedRtoMs = Date.now() - restoreStart;
    await close();
    await redisClient.stopRedis();
    write('backup.json', {
      run,
      archive: path.basename(archive),
      archiveBytes: fs.statSync(archive).size,
      archiveSha256: hostBefore,
      hashes: { dumpContainerHash, hostBefore, containerBefore, containerAfter, hostAfter },
      dumpMs,
      restoreMs,
      observedRtoMs,
      rtoScope:
        'Before restore transfer through document/index/ledger/relationship checks and restored app product/subscription/session/tombstone replay',
      rpo: {
        markerId: String(markerId),
        sequence: 1,
        acknowledgedAt: markerTime,
        acknowledgedMarkerWritesLost: 0,
        scope: 'Last fixture marker before quiesced dump; no concurrent writer/PITR guarantee',
      },
      consistency:
        'Host app listeners closed; no worker scheduler started; source inventory unchanged across dump; TTL fixtures not expired',
      namespaceInitiallyEmpty: true,
      noDrop: true,
      collectionCount: Object.keys(sourceInventory).length,
      documents: true,
      indexOptions: true,
      relationships: true,
      ledger: true,
      session: true,
      replay: true,
      tombstone: true,
      encrypted: false,
      offsite: false,
      pitr: false,
      tools: {
        dump: docker(['exec', fixture.resource.id, 'mongodump', '--version']).split('\n')[0],
        restore: docker(['exec', fixture.resource.id, 'mongorestore', '--version']).split('\n')[0],
      },
      exitCode: 0,
    });
    report.scenarios.push({
      name: '8a retained archive restore, integrity and real HTTP replay',
      status: 'pass',
    });
    report.exitCode = 0;
  } catch (error) {
    report.exitCode = 1;
    report.error = {
      name: error.name,
      message: error.message.replace(/mongodb[^\s]*/gi, '[redacted]'),
    };
    process.exitCode = 1;
  } finally {
    if (watchdogChild && watchdogChild.exitCode === null && watchdogChild.signalCode === null) {
      const child = watchdogChild;
      const exited = new Promise((resolve) =>
        child.once('exit', (code, signal) => {
          write('watchdog-exit.json', {
            run,
            pid: child.pid,
            exitCode: code,
            signal,
            cleanup: true,
          });
          resolve();
        }),
      );
      child.kill('SIGKILL');
      await exited;
    }
    if (server) await new Promise((r) => server.close(r));
    if (sink) await new Promise((r) => sink.close(r));
    try {
      await require('../../../src/config/redis').stopRedis();
    } catch {
      /* Setup may precede config. */
    }
    try {
      await mongoose.disconnect();
    } finally {
      try {
        await fixture?.cleanup();
      } finally {
        redis?.cleanup();
        write('operations.json', report);
      }
    }
  }
})().catch(() => {
  process.exitCode = 1;
});
