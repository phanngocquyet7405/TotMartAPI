const assert = require('node:assert/strict');
const faultNames = [
  'redis-stop-start',
  'redis-pause-unpause',
  'mongo-disconnect-reconnect',
  'backend-kill-restart',
];
function assertCases(report, count) {
  assert.equal(report.exitCode, 0);
  assert.equal(report.cleanupExitCode, 0);
  assert.equal(report.cases.length, count);
  assert.equal(new Set(report.cases.map((item) => item.name)).size, count);
  assert(report.cases.every((item) => item.passed === true));
}
function assertJest(data, expected) {
  assert.equal(data.success, true);
  assert.equal(data.numFailedTests, 0);
  assert.equal(data.numPendingTests, 0);
  assert.equal(data.numTodoTests, 0);
  assert.equal(data.numFailedTestSuites, 0);
  assert.equal(data.numPendingTestSuites, 0);
  assert.equal(data.numRuntimeErrorTestSuites, 0);
  assert(data.numTotalTests > 0 && data.numTotalTestSuites > 0);
  assert.equal(data.numPassedTests, data.numTotalTests);
  assert.equal(data.numPassedTestSuites, data.numTotalTestSuites);
  const tests = data.suites.flatMap((suite) => suite.tests);
  assert.equal(tests.length, data.numTotalTests);
  assert.equal(data.suites.length, data.numTotalTestSuites);
  assert(data.suites.every((suite) => suite.status === 'passed'));
  assert(tests.every((test) => test.status === 'passed'));
  if (expected !== undefined) assert.equal(data.numPassedTests, expected);
}
function evaluate(input) {
  assert(input.owner.raw.length > 0);
  assert.equal(input.owner.raw, input.owner.quoted);
  assert(input.owner.raw.includes('B-A1-AV01 — hạ P1 xuống P2 theo quyết định của owner.'));
  for (const step of [
    'build',
    'runtime',
    'strict',
    'phase5',
    'faults',
    'code91',
    'http',
    'full',
    'lint',
    'format',
    'api',
    'verifier-tests',
  ])
    assert.equal(input.commands[step], 0, 'Missing/failed command ' + step);
  assert.equal(input.build.exitCode, 0);
  assert.equal(input.build.cleanupExitCode, 0);
  assert.equal(input.build.buildExitCode, 0);
  assert.equal(input.runtime.passed, true);
  assert.equal(input.runtime.cleanupExitCode, 0);
  assert.deepStrictEqual(input.runtime.runtime.files, input.runtime.expected);
  const image = input.build.image.id;
  assert.equal(input.runtime.image, image);
  assertCases(input.strict, 21);
  assertCases(input.phase5, 12);
  assert.equal(input.phase5.notRun, 0);
  assert.equal(input.phase5.runtimeTreeMatches, true);
  assert.equal(input.strict.candidateImage, image);
  assert.equal(input.phase5.candidateImage, image);
  assertCases(input.faults, 4);
  assert.deepStrictEqual(
    input.faults.cases.map((item) => item.name).sort(),
    [...faultNames].sort(),
  );
  assert.equal(input.faults.faultsOneAtATime, true);
  for (const row of input.faults.cases) {
    assert.equal(row.cleanupExitCode, 0);
    assert.equal(row.runtime.length, 2);
    assert(row.runtime.every((runtime) => runtime.matched && runtime.image === image));
    assert.equal(row.logGuardFailures.length, 0);
  }
  const contract = input.code91;
  assert.equal(contract.passed, true);
  assert.equal(contract.exitCode, 0);
  assert.equal(contract.cleanupExitCode, 0);
  assert.equal(contract.result.initial.status, 503);
  assert.equal(contract.runtime.length, 2);
  assert(contract.runtime.every((runtime) => runtime.matched && runtime.image === image));
  assert.equal(contract.result.committedChecks.checkouts, 1);
  assert.equal(contract.result.committedChecks.orders, 1);
  assert.equal(contract.result.independentObserver.originalHttpPending, true);
  const held = contract.result.proxy.events.find((event) => event.event === 'commit_reply_held');
  const released = contract.result.proxy.events.find(
    (event) => event.event === 'server_reply_released',
  );
  assert.equal(held.ok, 1);
  assert.equal(held.writeConcernCode, 91);
  assert(held.errorLabels.includes('UnknownTransactionCommitResult'));
  assert(
    held.at <= contract.result.independentObserver.observedAt &&
      contract.result.independentObserver.observedAt < released.at,
  );
  assert.equal(contract.result.recoveryHealth.status, 200);
  assert(
    contract.result.discoveryRecovery.events.some((event) => event.event === 'discovery_recovered'),
  );
  assert.equal(contract.result.finalChecks.checkouts, 1);
  assert.equal(contract.result.finalChecks.orders, 1);
  assert.equal(contract.result.finalChecks.createdAttempts, 1);
  assert.equal(contract.result.finalChecks.stock, 99);
  assert.equal(contract.result.requests.slice(1).length, 3);
  assert(
    contract.result.requests
      .slice(1)
      .every(
        (request) =>
          request.status === 201 &&
          request.bodyHash === contract.result.initial.bodyHash &&
          request.keyEncrypted === contract.result.initial.keyEncrypted,
      ),
  );
  assert.equal(contract.logGuardFailures.length, 0);
  // No commit retry count requirement: code91 contract concerns outcome/recovery.
  for (const gate of [input.http, input.full]) {
    assert.equal(gate.exit.jestExitCode, 0);
    assert.equal(gate.exit.runnerExitCode, 0);
    assert.equal(gate.exit.cleanupExitCode, 0);
  }
  assertJest(input.http.jest, 16);
  assertJest(input.full.jest);
  assert.equal(input.full.exit.coverageExitCode, 0);
  assert.equal(input.full.coverage.modules, 8);
  assert.deepStrictEqual(input.full.coverage.failures, []);
  return {
    image,
    status: 'PASS_WITH_ACCEPTED_OPEN_P2',
    issue: 'B-A1-AV01',
    severity: 'P2',
    issueState: 'open',
    productionReady: false,
    roundCAuthorized: false,
  };
}
function compareComplete(expected, actual) {
  assert.deepStrictEqual(actual, expected, 'Complete manifest paths and bytes must match');
}
function compareSealSummary(seal, current) {
  const metadata = [
    'generatedAt',
    'generatedBy',
    'verifierSha256',
    'sourceManifestSha256',
    'evidenceManifestSha256',
  ];
  const sealedSummary = Object.fromEntries(
    Object.entries(seal).filter(([key]) => !metadata.includes(key)),
  );
  const currentSummary = Object.fromEntries(
    Object.entries(current).filter(([key]) => !['source', 'evidence'].includes(key)),
  );
  compareComplete(currentSummary, sealedSummary);
}
module.exports = { evaluate, assertJest, compareComplete, compareSealSummary };
