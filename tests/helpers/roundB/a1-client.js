const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { A } = require('./client');
const E = require('./mongo-evidence-client');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const probe = JSON.parse(process.argv[2]);
  const state = E.load();
  const row = { ...probe, deadlineMs: 30000, blockTimeMS: 20000, checks: [] };
  let control, pending, disabling;
  try {
    await A.db.connect();
    control = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
      appName: 'totmart-fixture-a1-control',
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    await control.connect();
    const admin = control.db('admin');
    const point = await admin.command({
      configureFailPoint: 'failCommand',
      mode: probe.duplicate ? { times: 1 } : probe.skip ? { skip: probe.skip } : { times: 1 },
      data: probe.duplicate
        ? {
            failCommands: ['insert'],
            namespace: mongoose.connection.name + '.checkoutattempts',
            appName: 'totmart-fixture-production',
            errorCode: 11000,
            errorExtraInfo: { keyPattern: { userId: 1, kind: 1, key: 1 }, keyValue: {} },
          }
        : {
            failCommands: ['find'],
            appName: 'totmart-fixture-production',
            namespace: mongoose.connection.name + '.' + probe.collection,
            blockConnection: true,
            blockTimeMS: row.blockTimeMS,
          },
    });
    row.failpointStartCount = point.count;
    row.startedAt = Date.now();
    pending = E.request(
      0,
      state.f.path,
      'POST',
      state.f.body,
      {
        ...state.f.auth,
        'Idempotency-Key': state.f.key,
        ...(probe.duplicate ? { 'X-Fixture-A1-Duplicate': '1' } : {}),
      },
      row.deadlineMs,
      probe.name,
    );
    await admin.command({
      waitForFailPoint: 'failCommand',
      timesEntered: point.count + (probe.duplicate ? 2 : 1),
      maxTimeMS: 8000,
    });
    row.barrierAt = Date.now();
    disabling = admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    const response = await pending;
    row.request = response.record;
    for (const [name, verify] of [
      ['safe-503', () => assert.equal(response.record.status, 503)],
      [
        'bounded-read',
        () => assert(response.record.durationMs >= 4500 && response.record.durationMs <= 8000),
      ],
      [
        'request-id',
        () => {
          assert(response.record.xRequestId);
          assert.equal(response.body.requestId, response.record.xRequestId);
        },
      ],
      [
        'safe-body',
        () => {
          assert.equal(response.body.success, false);
          assert(!/Mongo|stack|mongodb:|ECONN|node_modules/.test(JSON.stringify(response.body)));
        },
      ],
    ]) {
      try {
        verify();
        row.checks.push({ name, passed: true });
      } catch {
        row.checks.push({ name, passed: false, classification: 'application-assertion' });
      }
    }
  } catch (error) {
    row.harnessError = { type: error.name, code: error.code };
  } finally {
    try {
      if (pending && !row.request) row.request = (await pending).record;
      if (disabling) await disabling;
      else if (control)
        await control.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      await sleep(Math.max(0, (row.startedAt || Date.now()) + 20300 - Date.now()));
      row.pingRecovered = (await control.db('admin').command({ ping: 1 })).ok === 1;
    } catch (error) {
      row.recoveryError = { type: error.name, code: error.code };
    }
    await control?.close();
    await A.db.closeDatabase();
  }
  row.snapshot = await E.snapshot('a1-after-server-sleep');
  const collections = row.snapshot.collections;
  const count = collections.Checkout.length;
  if (count) E.invariant(row.snapshot, count);
  row.noLateObligation =
    count === 0 &&
    collections.Order.length === 0 &&
    collections.CheckoutAttempt.length === 0 &&
    collections.Product.find((p) => p._id === state.f.product._id).stock === 100;
  row.checks.push({
    name: 'no-late-obligation',
    passed: row.noLateObligation,
    classification: 'application-assertion',
  });
  row.passed =
    !row.harnessError &&
    !row.recoveryError &&
    row.pingRecovered &&
    row.checks.every((c) => c.passed);
  console.log('A1_RESULT=' + JSON.stringify(row));
}
main().catch((error) => {
  console.log(
    'A1_RESULT=' + JSON.stringify({ passed: false, fatal: { type: error.name, code: error.code } }),
  );
  process.exitCode = 1;
});
