const fs = require('node:fs');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const E = require('./mongo-evidence-client');
const { A } = require('./client');
const mode = process.argv[2];
const serverInjected = ['server-unknown-applied', 'server-code91-contract'].includes(mode);
const row = { mode, requests: [], sourceBEChanged: false };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function proxy(action, method = 'GET') {
  const response = await fetch('http://mongo-ack:28080/' + action, {
    method,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, 'ACK proxy control');
  return response.json();
}
async function main() {
  let control,
    pending,
    settled = false;
  try {
    const state = E.load(),
      headers = { ...state.f.auth, 'Idempotency-Key': state.f.key };
    row.stage = 'prepare';
    const prepared = await E.request(
      0,
      '/api/checkout/attempts/products/prepare',
      'POST',
      state.f.body,
      headers,
      15000,
      'explicit prepare before targeted commerce commit',
    );
    row.requests.push(prepared.record);
    assert.equal(prepared.record.status, 200);
    control = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    await control.connect();
    const database = control.db();
    assert.equal(database.databaseName, 'totmart_b_' + process.env.FIXTURE_RUN.replaceAll('-', ''));
    assert.equal(
      (await database.collection('_roundBRun').findOne({ _id: process.env.FIXTURE_RUN }))?.owner,
      process.env.FIXTURE_RUN,
    );
    row.mongoProcessId = String(
      (await database.admin().command({ hello: 1 })).topologyVersion.processId,
    );
    if (serverInjected) {
      const point = await database.admin().command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: {
          failCommands: ['commitTransaction'],
          appName: 'totmart-fixture-production',
          writeConcernError: {
            code: mode === 'server-code91-contract' ? 91 : 64,
            codeName:
              mode === 'server-code91-contract' ? 'ShutdownInProgress' : 'WriteConcernFailed',
            errmsg: 'Synthetic commit acknowledgement fault',
          },
          errorLabels: ['UnknownTransactionCommitResult'],
        },
      });
      row.failpointStartCount = point.count;
    }
    row.stage = 'wire-barrier';
    await proxy(mode === 'server-code91-contract' ? 'arm-code91' : 'arm', 'POST');
    pending = E.request(0, state.f.path, 'POST', state.f.body, headers, 45000, mode).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    const deadline = Date.now() + 15000;
    let status;
    while (Date.now() < deadline) {
      status = await proxy('status');
      if (status.holding) break;
      await sleep(100);
    }
    assert(status.holding, 'Server commit response must be held at Mongo wire proxy');
    const held = status.events.find((event) => event.event === 'commit_reply_held');
    assert.equal(held.ok, 1);
    assert.equal(held.writeConcernError, serverInjected);
    if (serverInjected) assert(held.errorLabels.includes('UnknownTransactionCommitResult'));
    assert.equal(settled, false, 'Original HTTP must remain pending before observer');
    row.stage = 'independent-observer';
    row.observedWhileAckHeld = await E.snapshot('a2-committed-before-ack');
    try {
      row.committedChecks = E.invariant(row.observedWhileAckHeld, 1);
    } catch (error) {
      row.p0 = true;
      throw error;
    }
    assert.equal(settled, false, 'Mongo reply is still held after independent majority snapshot');
    row.independentObserver = {
      directMongo: true,
      separateClient: true,
      snapshotReadConcern: true,
      heldAt: held.at,
      observedAt: row.observedWhileAckHeld.at,
      originalHttpPending: true,
    };
    row.stage = 'ack-fault';
    const action = serverInjected ? 'release' : 'drop';
    row.proxy = await proxy(action, 'POST');
    row.initial = (await pending).record;
    if (mode === 'server-code91-contract') {
      row.discoveryRecovery = await proxy('recover-code91', 'POST');
    }
    if (serverInjected) {
      const off = await database
        .admin()
        .command({ configureFailPoint: 'failCommand', mode: 'off' });
      row.failpointEndCount = off.count;
      assert.equal(off.count - row.failpointStartCount, 1);
    }
    row.stage = 'same-key-replay';
    if (mode === 'server-code91-contract') {
      const until = Date.now() + 15000;
      do {
        row.recoveryHealth = (await E.request(0, '/api/home/health')).record;
        if (row.recoveryHealth.status === 200) break;
        await sleep(100);
      } while (Date.now() < until);
      assert.equal(row.recoveryHealth.status, 200);
    }
    for (const index of [0, 1, 0]) {
      const replay = await E.request(
        index,
        state.f.path,
        'POST',
        state.f.body,
        headers,
        45000,
        'A2 same-key/body replay',
      );
      row.requests.push(replay.record);
      assert.equal(replay.record.status, 201);
      assert.deepStrictEqual(
        replay.body.data,
        row.observedWhileAckHeld.collections.Checkout[0].result,
      );
    }
    row.final = await E.snapshot('a2-after-two-backend-replays');
    try {
      row.finalChecks = E.invariant(row.final, 1);
    } catch (error) {
      row.p0 = true;
      throw error;
    }
    assert(
      row.requests
        .slice(1)
        .every(
          (request) =>
            request.bodyHash === row.initial.bodyHash &&
            request.keyEncrypted === row.initial.keyEncrypted,
        ),
    );
    if (mode === 'server-code91-contract') {
      assert.equal(row.initial.status, 503, 'Committed code91 request must return original 503');
      assert.equal(row.initial.body.requestId, row.initial.xRequestId);
      assert.equal(row.initial.body.message, 'Lỗi hệ thống. Vui lòng thử lại.');
    }
    row.passed = true;
  } catch (error) {
    row.passed = false;
    row.error = {
      type: error.name,
      code: error.code,
      assertion: error.name === 'AssertionError' ? error.message.split('\n')[0] : undefined,
    };
    row.classification = row.p0
      ? 'application P0 obligation invariant'
      : 'undetermined; inspect stage and observer evidence';
  } finally {
    try {
      await proxy('drop', 'POST');
    } catch {
      /* No held reply is the expected normal end. */
    }
    if (mode === 'server-code91-contract') {
      try {
        await proxy('recover-code91', 'POST');
      } catch {
        row.faultRecoveryFailed = true;
      }
    }
    if (control) {
      try {
        await control.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      } catch {
        row.faultRecoveryFailed = true;
      }
    }
    if (pending) await pending;
    await control?.close();
    await A.db.closeDatabase();
    fs.writeFileSync('/fixture/a2-result.json', JSON.stringify(row));
    console.log('A2_RESULT=' + JSON.stringify(row));
  }
}
main().catch(() => {
  process.exitCode = 1;
});
