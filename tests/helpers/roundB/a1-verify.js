// Delivery/integrity verifier only; never a seal or an acceptance override.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const read = (file) => JSON.parse(fs.readFileSync(file));
const latest = (name) => fs.readFileSync(root + '/' + name + '-latest.txt', 'utf8').trim();
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const entry = read(root + '/entry.json');
const before = read(root + '/source-before.json');
const current = sourceManifest();
const candidate = read(root + '/candidate.json');
const report = {
  head: entry.head,
  image: candidate.image,
  checks: {},
  gates: {},
  seal: 'NOT-RUN / not authorized',
  roundCAuthorized: false,
};
function ast(source) {
  return JSON.parse(
    JSON.stringify(
      require('@babel/parser').parse(source, { sourceType: 'script' }),
      (key, value) =>
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
          : value,
    ),
  );
}
const functions = (source) =>
  Object.fromEntries(
    ast(source)
      .program.body.filter((node) => node.type === 'FunctionDeclaration')
      .map((node) => [node.id.name, node]),
  );
function calls(node, name) {
  if (!node || typeof node !== 'object') return [];
  return [
    ...(node.type === 'CallExpression' && node.callee.property?.name === name ? [node] : []),
    ...Object.values(node).flatMap((value) =>
      Array.isArray(value) ? value.flatMap((item) => calls(item, name)) : calls(value, name),
    ),
  ];
}
function command(name) {
  const pointer = root + '/command-' + name.replaceAll(':', '-') + '-latest.txt';
  return fs.existsSync(pointer) ? read(fs.readFileSync(pointer, 'utf8') + '/report.json') : null;
}
function csv(file, rows) {
  const keys = Object.keys(rows[0] || {}),
    escape = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(
    root + '/' + file,
    [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join(
      '\n',
    ) + '\n',
  );
}
async function main() {
  try {
    assert.equal(
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      entry.head,
    );
    for (const [file, hash] of Object.entries(entry.historicalHashes))
      assert.equal(sha256(fs.readFileSync(file)), hash);
    const timeline = read(root + '/timeline-correction.json');
    assert.equal(sha256(fs.readFileSync(timeline.original)), timeline.originalSha256);
    report.checks.historyUnchanged = true;
    const changedSource = Object.keys(current)
      .filter((file) => file.startsWith('src/') && current[file] !== before[file])
      .sort();
    assert.deepEqual(changedSource, [
      'src/services/checkoutAttemptService.js',
      'src/services/checkoutLifecycle.js',
    ]);
    for (const file of changedSource) {
      const oldSource = fs.readFileSync(
        root + '/before/' + file.replaceAll('/', '__') + '.txt',
        'utf8',
      );
      const finalSource = fs.readFileSync(file, 'utf8');
      const oldFunctions = functions(oldSource),
        finalFunctions = functions(finalSource);
      for (const [name, value] of Object.entries(oldFunctions))
        if (!['replay', 'prepare'].includes(name)) assert.deepEqual(finalFunctions[name], value);
      if (oldFunctions.prepare)
        assert.deepEqual(
          calls(finalFunctions.prepare, 'transaction'),
          calls(oldFunctions.prepare, 'transaction'),
        );
      assert.deepEqual(
        ast(finalSource),
        ast(
          fs.readFileSync(root + '/behavior-before-format/' + path.basename(file) + '.txt', 'utf8'),
        ),
      );
    }
    for (const [file, hash] of Object.entries(candidate.runtimeSourceHashes))
      assert.equal(current[file], hash);
    for (const file of Object.keys(before).filter((file) => file.startsWith('tooling/')))
      assert.equal(current[file], before[file]);
    report.checks.behaviorScopeAndFormat =
      'Only four nontransaction read sites; transaction callbacks and other runtime files unchanged';
    const redReports = fs
      .readdirSync(root)
      .filter((name) => name.startsWith('red-') && fs.statSync(root + '/' + name).isDirectory())
      .map((name) => read(root + '/' + name + '/report.json'))
      .sort(
        (a, b) =>
          fs.statSync(a.directory + '/report.json').mtimeMs -
          fs.statSync(b.directory + '/report.json').mtimeMs,
      );
    const green = read(latest('green') + '/report.json');
    assert.equal(green.exitCode, 0);
    assert.equal(green.cleanupExitCode, 0);
    assert.equal(green.probes.length, 4);
    const comparisons = [];
    for (const p of green.probes) {
      const red = redReports
        .flatMap((r) => r.probes)
        .find((row) => row.name === p.name && row.targetProven && !row.harnessError);
      assert(red && !red.passed);
      assert(red.request.durationMs >= 19000);
      assert(
        p.passed &&
          p.noContinuation &&
          p.noLateObligation &&
          p.snapshotUnchanged &&
          p.recovery.passed,
      );
      assert.equal(p.request.status, 503);
      assert(p.request.xRequestId);
      assert.equal(p.request.body.requestId, p.request.xRequestId);
      assert(p.request.durationMs >= 4500 && p.request.durationMs <= 8000);
      assert.equal(p.target.start.timeoutMS, 5000);
      assert.equal(p.target.start.transaction, false);
      assert.equal(p.target.end.errorType, 'MongoOperationTimeoutError');
      assert.equal(p.target.end.outcome, 'error');
      comparisons.push({
        read: p.name,
        method: p.request.method,
        path: p.request.path,
        beforeStatus: red.request.status,
        beforeMs: red.request.durationMs,
        afterStatus: p.request.status,
        afterMs: p.request.durationMs,
        requestId: p.request.xRequestId,
        unchangedSnapshot: p.snapshotUnchanged,
        replayAndNewKey: p.recovery.passed,
      });
    }
    csv('read-comparison.csv', comparisons);
    report.gates.a1 = { pass: 4, fail: 0, skip: 0, notRun: 0 };
    const workerReports = fs
      .readdirSync(root)
      .filter((name) => name.startsWith('workers-') && fs.statSync(root + '/' + name).isDirectory())
      .map((name) => read(root + '/' + name + '/report.json'))
      .sort(
        (a, b) =>
          fs.statSync(a.directory + '/report.json').mtimeMs -
          fs.statSync(b.directory + '/report.json').mtimeMs,
      );
    for (const item of workerReports) {
      assert.equal(item.image, candidate.image.id);
      assert.equal(item.cleanupExitCode, 0);
    }
    const workerCases = [
      'backend',
      'expiry',
      'payment',
      'delivery',
      'notification',
      'security',
    ].map((kind) => {
      const evidence = workerReports.findLast(
        (r) => r.cases.some((c) => c.kind === kind && c.passed) && r.cleanupExitCode === 0,
      );
      return { kind, passed: !!evidence, evidence: evidence?.directory };
    });
    csv('worker-matrix.csv', workerCases);
    report.gates.workers = workerCases;
    assert(workerCases.every((row) => row.passed));
    report.gates.workerCounts = {
      familiesPassed: 5,
      familiesFailed: 0,
      familiesNotRun: 0,
      backendSmokePassed: 1,
    };
    const containers = new Set(
      docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    const networks = new Set(
      docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    const resources = [...redReports, green, ...workerReports].flatMap((r) => r.resources || []);
    for (const name of ['test:b01:http', 'test:b01'])
      for (const artifact of command(name)?.artifacts || [])
        for (const file of fs
          .readdirSync(artifact.directory)
          .filter((file) => /resources?\.json$/.test(file))) {
          const visit = (value) => {
            if (!value || typeof value !== 'object') return;
            if (/^[a-f0-9]{64}$/.test(value.id || '') && /^[a-f0-9-]{36}$/.test(value.owner || ''))
              resources.push({ type: 'container', id: value.id, owner: value.owner });
            Object.values(value).forEach((item) =>
              Array.isArray(item) ? item.forEach(visit) : visit(item),
            );
          };
          visit(read(artifact.directory + '/' + file));
        }
    resources.push({ type: 'container', id: candidate.probe.id });
    for (const resource of resources)
      assert(!(resource.type === 'network' ? networks : containers).has(resource.id));
    const originalInventory = read(root + '/docker-entry.json')
      .output.split('\n')
      .map((line) => line.trim());
    const finalContainers = new Set(
      docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).split('\n'),
    );
    const protectedContainers = originalInventory.filter((line) =>
      /^[a-f0-9]{64} hubt-/.test(line),
    );
    assert.equal(protectedContainers.length, 4);
    for (const line of protectedContainers) assert(finalContainers.has(line));
    const finalImages = new Set(
      docker(['image', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}']).split(
        '\n',
      ),
    );
    const protectedImages = originalInventory.filter((line) => /^sha256:[a-f0-9]{64} /.test(line));
    assert(protectedImages.length >= 6);
    for (const line of protectedImages) assert(finalImages.has(line));
    report.checks.resources = {
      uniqueAbsent: new Set(resources.map((r) => r.id)).size,
      originalContainersPreserved: 4,
      originalImageLinesPreserved: true,
    };
    for (const name of ['lint', 'format:check', 'validate:api', 'test:b01:http', 'test:b01']) {
      const result = command(name);
      report.gates[name] = result
        ? {
            command: result.command,
            exitCode: result.exitCode,
            artifacts: result.artifacts.map((a) => ({
              directory: a.directory,
              exit: a.exit,
              counts: a.jest
                ? {
                    pass: a.jest.numPassedTests,
                    fail: a.jest.numFailedTests,
                    skip: a.jest.numPendingTests,
                  }
                : undefined,
              coverage: a.coverage,
            })),
          }
        : { status: 'NOT-RUN' };
    }
    if (fs.existsSync(root + '/b01-full-preflight.json'))
      report.gates['test:b01'] = read(root + '/b01-full-preflight.json');
    const indexPointer = root + '/index-regression-latest.txt';
    if (fs.existsSync(indexPointer)) {
      const indexDirectory = fs.readFileSync(indexPointer, 'utf8');
      const selected = read(indexDirectory + '/report.json');
      assert.equal(selected.jestExitCode, 0);
      report.gates.selectedIndexRegression = selected;
      const index = read(indexDirectory + '/b03-index-resource.json');
      assert(index.created && index.absent && index.cleanupExitCode === 0);
      assert.equal(index.name, 'b03_owned_legacy_display_fixture');
      assert(
        index.beforeDelete.instanceVerified &&
          index.beforeDelete.databaseVerified &&
          index.beforeDelete.collectionVerified,
      );
      report.checks.indexCleanup = index;
    }
    const budgetFiles = [
      'src/services/checkoutAttemptService.js',
      'src/controllers/checkOutController.js',
      'src/controllers/userSubscriptionController.js',
      'src/services/paymentReconciliationService.js',
      'src/services/subscriptionService.js',
      'src/jobs/orderExpiryScheduler.js',
    ];
    report.unbudgetedTransactionCalls = budgetFiles.flatMap((file) => {
      const tree = ast(fs.readFileSync(file, 'utf8'));
      return [...calls(tree, 'withTransaction'), ...calls(tree, 'transaction')]
        .filter((call) => call.arguments.length < 2)
        .map((call, index) => ({ file, call: call.callee.property.name, index }));
    });
    report.openP1Availability = report.unbudgetedTransactionCalls.length > 0;
    const policy = read('tooling/commerce-coverage-baseline.json');
    report.coverageSourceReviewPreflight = {
      coverageExecution: 'NOT-RUN when full is blocked',
      changedFiles: Object.entries(policy.files)
        .filter(([file, value]) => {
          const normalized = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
          return sha256(Buffer.from(normalized)) !== value.sourceSha256;
        })
        .map(([file]) => file),
      policyUnchanged: true,
    };
    report.integrityExitCode = 0;
  } catch (error) {
    report.integrityExitCode = 1;
    report.integrityError = { type: error.name, message: error.message };
  }
  report.roundBPassed =
    report.integrityExitCode === 0 &&
    !report.openP1Availability &&
    report.gates.workers?.every((row) => row.passed) &&
    ['lint', 'format:check', 'validate:api', 'test:b01:http', 'test:b01'].every(
      (name) => report.gates[name]?.exitCode === 0,
    );
  report.roundCEntrySatisfied = false;
  report.remaining = [
    'A2: transaction/commit I/O budget and unknown-commit recovery unresolved; no authority to change them in A1',
    'Acceptance requires actual worker/B01/coverage gates, not historical auth counts',
  ];
  fs.writeFileSync(root + '/delivery-verification.json', JSON.stringify(report, null, 2));
  const exportDirectory = root + '/full-files-' + randomUUID();
  fs.mkdirSync(exportDirectory, { recursive: true });
  const edited = Object.keys(current).filter((file) => before[file] !== current[file]);
  for (const doc of [
    'docs/B-a1-verification.md',
    'docs/B-auth-csot-verification.md',
    'docs/B-verification.md',
    'docs/BE-open-issues.md',
  ])
    if (!edited.includes(doc)) edited.push(doc);
  const exports = [];
  for (const file of edited) {
    const group = file.startsWith('src/')
      ? 'format-final'
      : file.startsWith('docs/')
        ? 'docs'
        : 'tooling';
    const target = exportDirectory + '/' + group + '/' + file.replaceAll('/', '__') + '.txt';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    exports.push({ file, group, target, sha256: sha256(fs.readFileSync(target)) });
  }
  for (const file of ['checkoutAttemptService.js', 'checkoutLifecycle.js']) {
    const target = exportDirectory + '/behavior-before-format/' + file + '.txt';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(root + '/behavior-before-format/' + file + '.txt', target);
    exports.push({
      file,
      group: 'behavior-before-format',
      target,
      sha256: sha256(fs.readFileSync(target)),
    });
  }
  fs.writeFileSync(
    root + '/file-delivery.json',
    JSON.stringify({ exportDirectory, files: exports }, null, 2),
  );
  fs.writeFileSync(root + '/source-final.json', JSON.stringify(current, null, 2));
  console.log(
    JSON.stringify({
      root,
      integrityExitCode: report.integrityExitCode,
      checks: report.checks,
      roundBPassed: report.roundBPassed,
      roundCEntrySatisfied: false,
      fileCount: exports.length,
      exportDirectory,
    }),
  );
  process.exitCode = report.integrityExitCode;
}
main();
