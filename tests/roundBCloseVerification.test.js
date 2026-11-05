const { evaluate, compareComplete, compareSealSummary } = require('./helpers/roundB/close-policy');
function fixture() {
  const cases = (count) => ({
    exitCode: 0,
    cleanupExitCode: 0,
    cases: Array.from({ length: count }, (_, index) => ({ name: 'case-' + index, passed: true })),
    candidateImage: 'image',
  });
  const jest = (count) => ({
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numRuntimeErrorTestSuites: 0,
    numTotalTests: count,
    numPassedTests: count,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    suites: [
      { status: 'passed', tests: Array.from({ length: count }, () => ({ status: 'passed' })) },
    ],
  });
  const gate = (count) => ({
    exit: { jestExitCode: 0, runnerExitCode: 0, cleanupExitCode: 0, coverageExitCode: 0 },
    jest: jest(count),
    coverage: { modules: 8, failures: [] },
  });
  const raw = 'B-A1-AV01 — hạ P1 xuống P2 theo quyết định của owner.';
  return {
    owner: { raw, quoted: raw },
    commands: Object.fromEntries(
      [
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
      ].map((step) => [step, 0]),
    ),
    build: { exitCode: 0, cleanupExitCode: 0, buildExitCode: 0, image: { id: 'image' } },
    runtime: {
      passed: true,
      cleanupExitCode: 0,
      image: 'image',
      runtime: { files: { source: 'hash' } },
      expected: { source: 'hash' },
    },
    strict: cases(21),
    phase5: { ...cases(12), notRun: 0, runtimeTreeMatches: true },
    faults: {
      ...cases(4),
      faultsOneAtATime: true,
      cases: [
        'redis-stop-start',
        'redis-pause-unpause',
        'mongo-disconnect-reconnect',
        'backend-kill-restart',
      ].map((name) => ({
        name,
        passed: true,
        cleanupExitCode: 0,
        runtime: [
          { matched: true, image: 'image' },
          { matched: true, image: 'image' },
        ],
        logGuardFailures: [],
      })),
    },
    code91: {
      passed: true,
      exitCode: 0,
      cleanupExitCode: 0,
      logGuardFailures: [],
      runtime: [
        { matched: true, image: 'image' },
        { matched: true, image: 'image' },
      ],
      result: {
        initial: { status: 503, bodyHash: 'body', keyEncrypted: 'reference' },
        committedChecks: { checkouts: 1, orders: 1 },
        independentObserver: { originalHttpPending: true, observedAt: 2 },
        proxy: {
          events: [
            {
              event: 'commit_reply_held',
              ok: 1,
              writeConcernCode: 91,
              errorLabels: ['UnknownTransactionCommitResult'],
              at: 1,
            },
            { event: 'server_reply_released', at: 3 },
          ],
        },
        discoveryRecovery: { events: [{ event: 'discovery_recovered' }] },
        recoveryHealth: { status: 200 },
        finalChecks: { checkouts: 1, orders: 1, createdAttempts: 1, stock: 99 },
        requests: [
          { status: 200 },
          ...Array.from({ length: 3 }, () => ({
            status: 201,
            bodyHash: 'body',
            keyEncrypted: 'reference',
          })),
        ],
      },
    },
    http: gate(16),
    full: gate(2),
  };
}
test('seal policy permits accepted open P2 with code91 recovery and no two-commit requirement', () => {
  expect(evaluate(fixture())).toMatchObject({
    severity: 'P2',
    issueState: 'open',
    productionReady: false,
    roundCAuthorized: false,
  });
});
test.each([
  'skip',
  'missing',
  'duplicate',
  'cleanup',
  'image',
  'coverage',
  'owner',
  'obligation',
  'body',
  'empty',
  'ack-proof',
])('seal policy refuses %s evidence', (kind) => {
  const input = fixture();
  if (kind === 'skip') input.full.jest.numPendingTests = 1;
  if (kind === 'missing') delete input.commands.api;
  if (kind === 'duplicate') input.strict.cases[1].name = input.strict.cases[0].name;
  if (kind === 'cleanup') input.faults.cases[0].cleanupExitCode = 1;
  if (kind === 'image') input.phase5.candidateImage = 'old-image';
  if (kind === 'coverage') input.full.coverage.failures.push({ reason: 'source changed' });
  if (kind === 'owner') input.owner.quoted += 'changed';
  if (kind === 'obligation') input.code91.result.finalChecks.orders = 2;
  if (kind === 'body') input.code91.result.requests[1].bodyHash = 'different';
  if (kind === 'empty') input.full.jest.numTotalTests = 0;
  if (kind === 'ack-proof') input.code91.result.independentObserver.observedAt = 4;
  expect(() => evaluate(input)).toThrow();
});
test('complete manifests reject added files, removed files and changed bytes', () => {
  expect(() => compareComplete({ a: '1' }, { a: '1', b: '2' })).toThrow();
  expect(() => compareComplete({ a: '1' }, {})).toThrow();
  expect(() => compareComplete({ a: '1' }, { a: '2' })).toThrow();
});
test('seal check refuses edited status, gates and omitted open backlog', () => {
  const current = {
    source: {},
    evidence: {},
    status: 'PASS_WITH_ACCEPTED_OPEN_P2',
    gates: { full: 722 },
    backlog: { calls: [{ severity: 'P2', state: 'open' }] },
  };
  const seal = {
    generatedAt: 'fixture',
    generatedBy: 'fixture',
    verifierSha256: 'fixture',
    sourceManifestSha256: 'fixture',
    evidenceManifestSha256: 'fixture',
    status: current.status,
    gates: current.gates,
    backlog: current.backlog,
  };
  expect(() => compareSealSummary(seal, current)).not.toThrow();
  expect(() => compareSealSummary({ ...seal, status: 'production-ready' }, current)).toThrow();
  expect(() => compareSealSummary({ ...seal, gates: { full: 723 } }, current)).toThrow();
  expect(() => compareSealSummary({ ...seal, backlog: { calls: [] } }, current)).toThrow();
});
