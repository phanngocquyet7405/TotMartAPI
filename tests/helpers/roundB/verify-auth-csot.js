// Evidence verifier/exporter for this task. Does not create a Round A/B seal.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/auth-csot/current.json')).directory;
const read = (file) => JSON.parse(fs.readFileSync(file));
const latest = (name) =>
  fs.readFileSync('artifacts/round-b/auth-csot/' + name + '-latest.txt', 'utf8').trim();
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const entry = read(root + '/entry.json');
const before = read(root + '/before-manifest.json');
const current = sourceManifest();
const red = read(latest('red') + '/report.json');
const green = read(latest('green') + '/report.json');
const outageDirectory = fs
  .readFileSync('artifacts/round-b/auth-csot/outage45/latest.txt', 'utf8')
  .trim();
const outage = read(outageDirectory + '/report.json');
const waits = read(latest('after-auth') + '/report.json');
const correctionPath = 'artifacts/round-b/auth-csot/after-auth-correction-latest.txt';
const corrections = fs.existsSync(correctionPath)
  ? read(fs.readFileSync(correctionPath, 'utf8').trim() + '/report.json')
  : null;
const correctedMeasurements = [];
if (corrections) {
  for (const row of corrections.probes) {
    const index = waits.probes.findIndex((original) => original.name === row.name);
    assert(index !== -1);
    const original = waits.probes[index];
    correctedMeasurements.push({
      name: row.name,
      originalDurationMs: original.durationMs,
      originalBlockedCommands: original.mongo.filter(
        (event) => event.event === 'commandSucceeded' && event.durationMs >= 19000,
      ).length,
      correctedDurationMs: row.durationMs,
      correctionDirectory: corrections.directory,
    });
    waits.probes[index] = row;
  }
  waits.resources.push(...corrections.resources);
}
const candidate = read('artifacts/round-b/candidate.json');
const report = {
  head: entry.head,
  image: candidate.image,
  counts: { red: red.counts, green: green.counts, outage: outage.counts, waits: waits.counts },
  worker: 'NOT-RUN',
  b01: 'NOT-RUN',
  seal: 'NOT-RUN',
  evidence: {
    red: latest('red'),
    green: latest('green'),
    outage: outageDirectory,
    waits: latest('after-auth'),
  },
  checks: {},
  correctedMeasurements,
  retainedOwnedImages: [candidate, read(root + '/candidate-green-before-final-format.json')].map(
    ({ image, run, tag }) => ({ id: image.id, run, tag, retainedForReview: true }),
  ),
  cleanupScope:
    'Exact container/network/probe IDs; candidate images retained for review and later verification',
};
function csv(file, rows) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const quote = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(
    file,
    [
      keys.map(quote).join(','),
      ...rows.map((row) => keys.map((key) => quote(row[key])).join(',')),
    ].join('\n') + '\n',
  );
}
function normalizedAst(value) {
  const ast = require('@babel/parser').parse(value, { sourceType: 'script' });
  const plain = JSON.parse(
    JSON.stringify(ast, (key, item) =>
      [
        'start',
        'end',
        'loc',
        'extra',
        'comments',
        'leadingComments',
        'trailingComments',
        'innerComments',
      ].includes(key)
        ? undefined
        : item,
    ),
  );
  function normalize(node) {
    if (Array.isArray(node)) return node.map(normalize);
    if (!node || typeof node !== 'object') return node;
    const result = Object.fromEntries(
      Object.entries(node).map(([key, item]) => [key, normalize(item)]),
    );
    if (result.type !== 'LogicalExpression') return result;
    const operands = (item) =>
      item.type === 'LogicalChain' && item.operator === result.operator ? item.operands : [item];
    // Prettier removes redundant parentheses in same-operator logical chains.
    // Preserve operator and operand evaluation order, including short-circuit order.
    return {
      type: 'LogicalChain',
      operator: result.operator,
      operands: [...operands(result.left), ...operands(result.right)],
    };
  }
  return JSON.stringify(normalize(plain));
}
try {
  assert.equal(normalizedAst('a || (b || c);'), normalizedAst('(a || b) || c;'));
  assert.notEqual(normalizedAst('a || b;'), normalizedAst('a && b;'));
  assert.notEqual(normalizedAst('a || b;'), normalizedAst('b || a;'));
  report.checks.formatNormalization =
    'Ignore parser metadata/comments and flatten only same-operator logical chains, preserving operators and evaluation order';
  assert.deepStrictEqual(red.counts, { pass: 0, fail: 12, skip: 0, notRun: 0 });
  assert.deepStrictEqual(green.counts, { pass: 12, fail: 0, skip: 0, notRun: 0 });
  assert.equal(green.image, candidate.image.id);
  assert(
    green.rows.every(
      (row) =>
        row.status === 503 &&
        row.durationMs >= 4500 &&
        row.durationMs <= 8000 &&
        row.body.requestId === row.requestId &&
        !row.controllerEntered &&
        row.recovered &&
        row.revocationRecordMatched === 1 &&
        row.revokedAccessStatus === 401,
    ),
  );
  assert.equal(outage.exitCode, 0);
  assert.equal(outage.scenarios.length, 3);
  for (const run of outage.scenarios) {
    assert(run.actualFaultMs >= 150000);
    assert(run.recovery.delayed.snapshot.at - run.reconnectedAt >= 130000);
    assert(run.consistencyPassed && run.availabilityPassed && run.noOutageBusinessEffect);
    assert.equal(run.cleanupExitCode, 0);
    const checkouts = run.requests.filter((row) => row.purpose === 'outage checkout');
    assert.equal(checkouts.length, 2);
    assert(
      checkouts.every(
        (row) =>
          row.status === 503 &&
          row.outcome === 'http_response' &&
          row.durationMs <= 12000 &&
          row.xRequestId &&
          row.body.requestId === row.xRequestId,
      ),
    );
  }
  assert.equal(waits.exitCode, 0);
  if (corrections) assert.equal(corrections.exitCode, 0);
  assert.equal(waits.probes.length, 11);
  assert(
    waits.probes.every(
      (probe) => probe.targetObserved && probe.passedMeasurement && probe.replayRecovery.passed,
    ),
  );
  assert(
    waits.probes.every(
      (row) =>
        row.authPassedBeforeFault &&
        row.mongo.filter((event) => event.event === 'commandSucceeded' && event.durationMs >= 19000)
          .length === 1,
    ),
  );
  assert([red, green, waits].every((value) => value.cleanupExitCode === 0));
  const ids = new Set(docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}']).split('\n'));
  const networks = new Set(
    docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
  );
  const resources = [
    ...red.resources,
    ...green.resources,
    ...waits.resources,
    ...outage.scenarios.flatMap((value) => value.resources),
  ];
  for (const name of fs
    .readdirSync('artifacts/round-b/auth-csot')
    .filter(
      (name) =>
        name.startsWith('green-') &&
        fs.statSync('artifacts/round-b/auth-csot/' + name).isDirectory(),
    )) {
    const file = 'artifacts/round-b/auth-csot/' + name + '/report.json';
    if (fs.existsSync(file)) resources.push(...read(file).resources);
  }
  for (const file of [
    root + '/candidate-green-before-final-format.json',
    'artifacts/round-b/candidate.json',
  ]) {
    const probe = read(file).probe;
    resources.push({ type: 'container', ...probe });
  }
  report.checks.resources = [
    ...new Map(resources.map((resource) => [resource.id, resource])).values(),
  ].map((resource) => ({
    id: resource.id,
    name: resource.name,
    type: resource.type,
    absent: !(resource.type === 'network' ? networks : ids).has(resource.id),
  }));
  assert(report.checks.resources.every((resource) => resource.absent));
  const containers = docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).split(
    '\n',
  );
  assert(entry.containers.every((line) => containers.includes(line)));
  const images = new Set(docker(['image', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'));
  assert(entry.images.every((line) => images.has(line.split(' ')[0])));
  const imageTags = docker([
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]).split('\n');
  assert(entry.images.every((line) => imageTags.includes(line)));
  report.checks.protectedInventoryPresent = true;
  for (const [file, expected] of Object.entries(entry.historicalHashes))
    assert.equal(sha256(fs.readFileSync(file)), expected);
  report.checks.historicalAUnchanged = true;
  const behavior = [
    'src/config/authReadPolicy.js',
    'src/middleware/authMiddleware.js',
    'src/services/userIdentityService.js',
    'src/services/managerCatalogService.js',
    'src/routes/managerRouter.js',
  ];
  for (const [file, expected] of Object.entries(before).filter(
    ([file]) => file.startsWith('src/') && !behavior.includes(file),
  ))
    assert.equal(current[file], expected);
  for (const [file, expected] of Object.entries(candidate.runtimeSourceHashes))
    assert.equal(current[file], expected);
  report.checks.behaviorFormatAstEqual = behavior.every(
    (file) =>
      normalizedAst(fs.readFileSync(file, 'utf8')) ===
      normalizedAst(
        fs.readFileSync(root + '/' + file.replaceAll('/', '_') + '.behavior.txt', 'utf8'),
      ),
  );
  assert(report.checks.behaviorFormatAstEqual);
  const baseline = read(
    'artifacts/round-b/mongo-disconnect/dc14be58-f151-4d65-b356-1261787ab3e8/report.json',
  );
  const comparison = [];
  for (const run of outage.scenarios) {
    const old = baseline.scenarios.find(
      (value) => value.variant === '45s' && value.iteration === run.iteration,
    );
    const grouped = (rows) => {
      const counts = new Map();
      return rows.map((row) => {
        const key = [row.index, row.purpose, row.method, row.path].join('|');
        const n = counts.get(key) || 0;
        counts.set(key, n + 1);
        return { key: key + '|' + n, row };
      });
    };
    const a = new Map(grouped(old.requests).map((value) => [value.key, value.row]));
    const b = new Map(grouped(run.requests).map((value) => [value.key, value.row]));
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const left = a.get(key),
        right = b.get(key),
        row = right || left;
      comparison.push({
        iteration: run.iteration,
        backend: row.index === 0 ? 'production' : 'staging',
        method: row.method,
        path: row.path,
        purpose: row.purpose,
        occurrenceKey: key,
        beforeOutcome: left?.outcome || 'NOT-OBSERVED',
        beforeStatus: left?.status,
        beforeDurationMs: left?.durationMs,
        beforeDeadlineMs: left?.deadlineMs,
        beforeRequestId: left?.xRequestId,
        beforeServerRequestId: left?.serverRequestId,
        beforeKeyEncrypted: left?.keyEncrypted,
        beforeStartedAt: left?.startedAt,
        afterOutcome: right?.outcome || 'NOT-OBSERVED',
        afterStatus: right?.status,
        afterDurationMs: right?.durationMs,
        afterDeadlineMs: right?.deadlineMs,
        afterRequestId: right?.xRequestId,
        afterServerRequestId: right?.serverRequestId,
        afterKeyEncrypted: right?.keyEncrypted,
        afterStartedAt: right?.startedAt,
      });
    }
  }
  csv(root + '/request-comparison.csv', comparison);
  csv(
    root + '/checkout-comparison.csv',
    comparison.filter((row) => row.purpose === 'outage checkout'),
  );
  csv(
    root + '/read-comparison.csv',
    green.rows.map((row, n) => ({
      read: row.read,
      method: row.method,
      route: row.path,
      backend: row.index === 0 ? 'production' : 'staging',
      beforeStatus: red.rows[n].status,
      beforeMs: red.rows[n].durationMs,
      beforeControllerEntered: red.rows[n].controllerEntered,
      afterStatus: row.status,
      afterMs: row.durationMs,
      afterControllerEntered: row.controllerEntered,
      afterRequestId: row.requestId,
      revokedAccessStatus: row.revokedAccessStatus,
    })),
  );
  csv(
    root + '/after-auth-measurements.csv',
    waits.probes.map((row) => ({
      probe: row.name,
      source: row.source,
      transaction: row.transaction,
      status: row.status,
      outcome: row.outcome,
      durationMs: row.durationMs,
      deadlineMs: row.deadlineMs,
      requestId: row.request.xRequestId,
      blockedWireMs: row.blockedWire.end.durationMs,
      maxTimeMS: row.blockedWire.start.maxTimeMS,
      replayPassed: row.replayRecovery.passed,
    })),
  );
  const tooling = [
    'auth-csot-client',
    'auth-csot-image',
    'checkout-wait-client',
    'checkout-wait-image',
    'image-fixture',
    'topology',
    'mongo-observer',
    'mongo-evidence-client',
    'mongo-evidence-runner',
    'build-candidate',
    'verify-auth-csot',
  ].map((name) => 'tests/helpers/roundB/' + name + '.js');
  const files = [
    ...behavior,
    ...tooling,
    'tests/userAuthorization.test.js',
    'tests/manager.unit.test.js',
    'docs/FE-BE-contract-handoff.md',
    'docs/B-auth-csot-verification.md',
    'artifacts/round-b/auth-csot/run-selected.cjs',
  ];
  const exports = [];
  for (const file of behavior) {
    for (const [suffix, kind] of [
      ['behavior', 'behavior'],
      ['before', 'baseline'],
    ]) {
      const source = root + '/' + file.replaceAll('/', '_') + '.' + suffix + '.txt';
      if (!fs.existsSync(source)) continue;
      const destination = root + '/full-files/' + kind + '/' + file + '.txt';
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      exports.push({ file, kind, export: destination, sha256: sha256(fs.readFileSync(source)) });
    }
  }
  for (const file of files) {
    const kind = behavior.includes(file)
      ? 'format-final'
      : file.startsWith('docs/')
        ? 'documentation'
        : 'tooling';
    const destination = root + '/full-files/' + kind + '/' + file + '.txt';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    exports.push({ file, kind, export: destination, sha256: sha256(fs.readFileSync(file)) });
  }
  fs.writeFileSync(root + '/file-delivery.json', JSON.stringify(exports, null, 2));
  fs.copyFileSync('artifacts/round-b/candidate.json', root + '/candidate-final.json');
  fs.writeFileSync(root + '/final-source-manifest.json', JSON.stringify(current, null, 2));
  report.exitCode = 0;
} catch (error) {
  report.exitCode = 1;
  report.failure = { type: error.name, operator: error.operator, code: error.code };
}
fs.writeFileSync(root + '/task-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    directory: root,
    exitCode: report.exitCode,
    counts: report.counts,
    resourceCount: report.checks.resources?.length,
    failure: report.failure,
  }),
);
process.exitCode = report.exitCode;
