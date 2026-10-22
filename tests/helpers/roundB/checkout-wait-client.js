const fs = require('node:fs');
const mongoose = require('mongoose');
const { A } = require('./client');
const E = require('./mongo-evidence-client');
const assert = require('node:assert/strict');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const probe = JSON.parse(process.argv[2]);
  const state = E.load();
  const row = { ...probe, route: state.f.path, blockTimeMS: 20000, deadlineMs: 45000 };
  let pending, controlClient, disabling;
  try {
    await A.db.connect();
    // Independent control socket: configureFailPoint off waits for the active 20s sleep.
    // Runtime backend socket/CSOT/session options are untouched.
    controlClient = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
      appName: 'totmart-fixture-fault-control',
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    await controlClient.connect();
    const admin = controlClient.db('admin');
    const point = await admin.command({
      configureFailPoint: 'failCommand',
      mode: probe.skip ? { skip: probe.skip } : { times: 1 },
      data: {
        failCommands: [probe.command || 'find'],
        appName: 'totmart-fixture-production',
        ...(probe.collection
          ? { namespace: mongoose.connection.name + '.' + probe.collection }
          : {}),
        blockConnection: true,
        blockTimeMS: row.blockTimeMS,
      },
    });
    row.failpointStartCount = point.count;
    row.singlePointControl = true;
    row.startedAt = Date.now();
    try {
      pending = E.request(
        0,
        state.f.path,
        'POST',
        state.f.body,
        { ...state.f.auth, 'Idempotency-Key': state.f.key },
        row.deadlineMs,
        'after-auth measurement',
      );
      await admin.command({
        waitForFailPoint: 'failCommand',
        timesEntered: point.count + 1,
        maxTimeMS: 5000,
      });
      row.barrierAt = Date.now();
      // skip mode stays on after the selected command. Disable immediately at the
      // server barrier so later reads/commits in the same request are not also blocked.
      disabling = admin
        .command({ configureFailPoint: 'failCommand', mode: 'off' })
        .then((value) => {
          row.failpointEndCount = value.count;
          return value;
        });
      const value = await pending;
      row.request = value.record;
      row.durationMs = value.record.durationMs;
      row.outcome = value.record.outcome;
      row.status = value.record.status;
    } finally {
      if (disabling) await disabling;
      else await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
      row.recoveredAt = Date.now();
      await sleep(Math.max(0, row.startedAt + row.blockTimeMS + 300 - Date.now()));
      if (pending) await pending;
      row.pingRecovered = (await admin.command({ ping: 1 })).ok === 1;
    }
    await A.db.closeDatabase();
    row.snapshot = await E.snapshot('probe-recovered');
    // A completed 201 must correspond to exactly one committed COD obligation.
    if (row.status === 201) row.consistency = E.invariant(row.snapshot, 1);
    else {
      const count = row.snapshot.collections.Checkout.length;
      if (count === 1) row.consistency = E.invariant(row.snapshot, 1);
      else {
        assert.equal(count, 0);
        assert.equal(row.snapshot.collections.Order.length, 0);
        assert.equal(
          row.snapshot.collections.Product.find((p) => p._id === state.f.product._id).stock,
          100,
        );
        row.consistency = { noCommittedObligation: true, replayStillRequired: true };
      }
    }
    row.passedMeasurement = true;
  } catch (error) {
    row.errorType = error.name;
    row.errorCode = error.code;
    row.invariantFailure = error.name === 'AssertionError';
  } finally {
    await controlClient?.close();
    await A.db.closeDatabase();
    fs.writeFileSync('/fixture/checkout-wait-result.json', JSON.stringify(row));
    console.log('CHECKOUT_WAIT_RESULT=' + JSON.stringify(row));
  }
}
main().catch(() => {
  process.exitCode = 1;
});
