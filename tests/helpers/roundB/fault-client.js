const fs = require('node:fs');
const { A, F, purchaseFixture, stream, poll } = require('./client');
const { assert, db, http, business, token, digest } = A;
const file = '/fixture/private-fault.json';
async function run(command) {
  if (command === 'fault-arm') {
    await db.connect();
    const f = await purchaseFixture('products');
    const admin = (await F.createUser({ role: 'admin' })).user;
    fs.writeFileSync(file, JSON.stringify({ f, jwt: token(admin), before: await business() }));
    for (const name of [
      'watch-ready.json',
      'watch-result.json',
      'sse-fault-control.json',
      'sse-observer-stop.json',
    ])
      if (fs.existsSync('/fixture/' + name)) fs.unlinkSync('/fixture/' + name);
    return { armed: true };
  }
  const saved = JSON.parse(fs.readFileSync(file));
  if (command === 'fault-watch') {
    const { remoteClosure } = require('/fixture/sse-deadline');
    let state, control;
    const result = { passed: false, closed: false };
    try {
      state = await stream(saved.jwt);
      fs.writeFileSync(
        '/fixture/watch-ready.json',
        JSON.stringify({ opened: true, openedAt: state.openedAt }),
      );
      await poll(() => fs.existsSync('/fixture/sse-fault-control.json'), 30000);
      control = JSON.parse(fs.readFileSync('/fixture/sse-fault-control.json'));
      assert.equal(control.run, process.env.FIXTURE_RUN);
      assert.equal(control.deadlineAt, control.faultAt + 65000);
      while (!state.closed && Date.now() <= control.deadlineAt)
        await new Promise((r) => setTimeout(r, 100));
      result.passed = remoteClosure(state, control);
      result.closed = result.passed;
      Object.assign(result, {
        ...control,
        openedAt: state.openedAt,
        endAt: state.endAt,
        closeAt: state.closeAt,
        localDestroyAt: state.localDestroyAt,
        abortedAt: state.abortedAt,
        observedAt: Date.now(),
      });
      fs.writeFileSync('/fixture/watch-result.json', JSON.stringify(result));
      // Preserve a failed connection beyond the gate; never turn local teardown into success.
      while (
        !result.passed &&
        !fs.existsSync('/fixture/sse-observer-stop.json') &&
        Date.now() < control.faultAt + 120000
      )
        await new Promise((r) => setTimeout(r, 100));
      return result;
    } catch (error) {
      result.errorType = error.name;
      throw error;
    } finally {
      state?.destroy();
      result.localDestroyAt = state?.localDestroyAt;
      result.finishedAt = Date.now();
      fs.writeFileSync('/fixture/watch-result.json', JSON.stringify(result));
    }
  }
  if (command === 'fault-observe') {
    const responses = [];
    async function capture(index, path, method = 'GET', body, headers = {}, deadlineMs = 12000) {
      const startedAt = Date.now();
      const evidence = { index, path, method, startedAt, deadlineMs, body: null };
      try {
        const response = await http(index, path, method, body, headers, deadlineMs);
        evidence.status = response.status;
        evidence.xRequestId = response.headers['x-request-id'] || null;
        evidence.body = Object.fromEntries(
          ['success', 'status', 'message', 'code', 'requestId']
            .filter((field) => response.body[field] !== undefined)
            .map((field) => [field, response.body[field]]),
        );
        evidence.body = JSON.parse(
          JSON.stringify(evidence.body)
            .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s"\\]+/gi, '[REDACTED_URI]')
            .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]'),
        );
      } catch (error) {
        evidence.status = error.httpStatus ?? evidence.status ?? null;
        evidence.xRequestId = error.requestId ?? evidence.xRequestId ?? null;
        evidence.body = error.bodyRedacted ?? evidence.body;
        evidence.errorType =
          error.message === 'HTTP client deadline'
            ? 'client_timeout'
            : error.message === 'Invalid JSON HTTP response'
              ? 'parse'
              : error.code || 'transport_error';
        evidence.code = error.code || null;
      }
      evidence.endedAt = Date.now();
      evidence.durationMs = evidence.endedAt - startedAt;
      responses.push(evidence);
      fs.writeFileSync('/fixture/fault-observe-evidence.json', JSON.stringify(responses));
      return evidence;
    }
    for (const index of [0, 1]) {
      await capture(index, '/api/home/health');
      await capture(index, '/api/home/live');
      await capture(
        index,
        '/api/home/login',
        'POST',
        { email: 'silent.fixture@example.com', password: 'Synthetic-Fixture-Only' },
        {},
        45000,
      );
      await capture(
        index,
        saved.f.path,
        'POST',
        saved.f.body,
        { ...saved.f.auth, 'Idempotency-Key': saved.f.key },
        45000,
      );
    }
    // Collect every outcome before evaluating the unchanged status/requestId assertions.
    for (const response of responses) {
      assert.equal(response.status, response.path.endsWith('/live') ? 200 : 503);
      assert(response.xRequestId);
    }
    return { responses };
  }
  if (command === 'fault-recover') {
    await db.connect();
    // JSON serialization normalizes ObjectIds/Dates consistently on both sides.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await business())), saved.before);
    const h = { ...saved.f.auth, 'Idempotency-Key': saved.f.key };
    const a = await http(0, saved.f.path, 'POST', saved.f.body, h);
    const b = await http(1, saved.f.path, 'POST', saved.f.body, h);
    assert.deepStrictEqual([a.status, b.status], [201, 201]);
    assert.deepStrictEqual(a.body.data, b.body.data);
    assert.equal(
      await require('/app/src/models/Checkout').countDocuments({
        userId: saved.f.user._id,
        requestKey: saved.f.key,
      }),
      1,
    );
    assert.equal(
      (await require('/app/src/models/Product').findById(saved.f.product._id)).stock,
      99,
    );
    return {
      noLateBusinessEffect: true,
      recoveryReplay: true,
      stockOnce: true,
      snapshotHash: digest(saved.before),
    };
  }
  throw Error('Unsupported fault command');
}
module.exports = { run };
