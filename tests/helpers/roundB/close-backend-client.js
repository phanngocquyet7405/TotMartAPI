const fs = require('node:fs');
const assert = require('node:assert/strict');
const E = require('./mongo-evidence-client');
const { A } = require('./client');
async function main() {
  const action = process.argv[2],
    state = E.load();
  const row = { action };
  try {
    const resultFile = '/fixture/private-close-backend-result.json';
    if (action !== 'prime') {
      const ready = await E.request(1, '/api/home/health');
      assert.equal(ready.record.status, 200);
      if (action === 'survivor')
        assert.equal((await E.request(0, '/api/home/health')).record.status, 502);
    }
    const indices = action === 'prime' ? [0] : action === 'survivor' ? [1] : [0, 1];
    row.requests = [];
    for (const index of indices) {
      const response = await E.request(
        index,
        state.f.path,
        'POST',
        state.f.body,
        { ...state.f.auth, 'Idempotency-Key': state.f.key },
        45000,
        'backend ' + action,
      );
      row.requests.push(response.record);
      assert.equal(response.record.status, 201);
      if (action === 'prime') fs.writeFileSync(resultFile, JSON.stringify(response.body.data));
      else assert.deepStrictEqual(response.body.data, JSON.parse(fs.readFileSync(resultFile)));
    }
    row.snapshot = await E.snapshot('backend-' + action);
    row.checks = E.invariant(row.snapshot, 1);
    row.passed = true;
  } catch (error) {
    row.passed = false;
    row.errorType = error.name;
    row.p0 = error.name === 'AssertionError' && !!row.snapshot;
  } finally {
    await A.db.closeDatabase();
    console.log('CLOSE_BACKEND_RESULT=' + JSON.stringify(row));
  }
}
main().catch(() => {
  process.exitCode = 1;
});
