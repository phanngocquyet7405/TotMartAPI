const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sourceManifest, compareManifest, sha256 } = require('./evidence-manifest');

function verifyRun(directory, { mode, manifest, visibleIds }) {
  const failures = [];
  const requireJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    } catch {
      failures.push(`missing/invalid ${file}`);
      return null;
    }
  };
  const expected = requireJson('source-sha256.json');
  let delta;
  if (expected) {
    delta = compareManifest(expected, manifest);
    if (Object.values(delta).some((items) => items.length))
      failures.push('source manifest differs');
  }
  const exit = requireJson('exit.json');
  if (
    !exit ||
    exit.mode !== mode ||
    !/^v24\./.test(exit.node || '') ||
    exit.jestExitCode !== 0 ||
    exit.runnerExitCode !== 0 ||
    exit.cleanupExitCode !== 0 ||
    (mode === 'all' && exit.coverageExitCode !== 0)
  )
    failures.push('exit ledger failed/incomplete');
  const jest = requireJson('jest.json');
  const states = { passed: 0, failed: 0, pending: 0, other: 0 };
  if (jest) {
    for (const suite of jest.suites || []) {
      if (suite.status !== 'passed' || !suite.tests?.length)
        failures.push('suite incomplete/failed');
      for (const test of suite.tests || []) {
        if (Object.hasOwn(states, test.status)) states[test.status]++;
        else states.other++;
      }
    }
    if (
      jest.success !== true ||
      !states.passed ||
      states.failed ||
      states.pending ||
      states.other ||
      jest.numPassedTests !== states.passed ||
      jest.numTotalTests !== states.passed ||
      jest.numFailedTests !== 0 ||
      jest.numPendingTests !== 0 ||
      jest.numFailedTestSuites !== 0 ||
      jest.numPendingTestSuites !== 0 ||
      jest.numTotalTestSuites !== jest.suites?.length ||
      jest.numPassedTestSuites !== jest.suites?.length
    )
      failures.push('Jest statuses/counts failed/incomplete');
  }
  requireJson('coverage/coverage-summary.json');
  if (!fs.existsSync(path.join(directory, 'coverage/lcov.info')))
    failures.push('missing coverage/lcov.info');
  const resources = [];
  for (const file of [
    'primitives-resource.json',
    'http-resource.json',
    ...(mode === 'all' ? ['server-resource.json'] : []),
  ]) {
    const resource = requireJson(file);
    if (resource) resources.push({ file, ...resource });
  }
  let archive;
  if (mode === 'all') {
    const gate = requireJson('commerce-coverage-gate.json');
    if (!gate || !Array.isArray(gate.failures) || gate.failures.length || gate.modules !== 8)
      failures.push('coverage gate failed/incomplete');
    const opsResources = requireJson('b07-resources.json');
    for (const kind of ['mongo', 'redis']) {
      if (!opsResources?.[kind]) failures.push(`missing B07 ${kind} resource`);
      else resources.push({ file: 'b07-resources.json', kind, ...opsResources[kind] });
    }
    const evidence = requireJson('b07-evidence.json');
    const backup = Array.isArray(evidence)
      ? evidence.filter((e) => e.scenario === 'backup-restore')
      : [];
    if (backup.length !== 1) failures.push('missing/ambiguous restore evidence');
    else {
      const b = backup[0];
      if (b.archive !== 'b07-fixture.archive.gz' || b.runId !== path.basename(directory))
        failures.push('archive/run identity mismatch');
      const file = path.join(directory, 'b07-fixture.archive.gz');
      if (!fs.existsSync(file)) failures.push('missing mandatory archive');
      else {
        const bytes = fs.readFileSync(file);
        archive = {
          runId: path.basename(directory),
          file,
          bytes: bytes.length,
          sha256: sha256(bytes),
        };
        if (
          b.archiveSha256 !== archive.sha256 ||
          b.archiveBytes !== bytes.length ||
          b.archiveBeforeRestoreSha256 !== archive.sha256 ||
          b.archiveAfterRestoreSha256 !== archive.sha256 ||
          !b.restoreHashes ||
          ['before', 'after', 'containerBefore', 'containerAfter'].some(
            (k) => b.restoreHashes[k] !== archive.sha256,
          )
        )
          failures.push('archive checksum/restore chain mismatch');
        try {
          require('node:zlib').gunzipSync(bytes);
        } catch {
          failures.push('archive gzip unreadable');
        }
      }
      if (!b.destinationInitiallyEmpty || !b.countsAndIndexes || !b.relations || !b.sessionReplay)
        failures.push('restore checks incomplete');
    }
  }
  for (const r of resources) {
    r.absent = Array.isArray(visibleIds) ? !visibleIds.includes(r.id) : null;
    if (
      !/^[a-f0-9]{64}$/.test(r.id || '') ||
      !r.owner ||
      !r.name ||
      r.cleaned !== true ||
      r.absent !== true
    )
      failures.push('cleanup incomplete/unconfirmed');
  }
  return {
    directory,
    states,
    exit,
    delta,
    archive,
    resources,
    failures,
    valid: failures.length === 0,
  };
}

function main() {
  const [httpDirectory, fullDirectory, output] = process.argv.slice(2);
  if (!httpDirectory || !fullDirectory || !output)
    throw new Error('Supply HTTP directory, full directory and output JSON');
  let visibleIds = null;
  try {
    visibleIds = execFileSync('docker', ['ps', '-a', '--no-trunc', '--format', '{{.ID}}'], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split(/\s+/);
  } catch {
    /* Unavailable inventory fails validation; never infer absence. */
  }
  const manifest = sourceManifest();
  const runs = [
    verifyRun(httpDirectory, { mode: 'http', manifest, visibleIds }),
    verifyRun(fullDirectory, { mode: 'all', manifest, visibleIds }),
  ];
  let coverageRecomputed;
  try {
    coverageRecomputed = require('./check-commerce-coverage').checkCoverage(
      path.join(fullDirectory, 'coverage'),
    );
  } catch {
    coverageRecomputed = { failures: [{ reason: 'coverage recomputation unavailable' }] };
  }
  const report = {
    recordedAt: new Date().toISOString(),
    files: Object.keys(manifest).length,
    manifestSha256: sha256(JSON.stringify(manifest, null, 2) + '\n'),
    cleanupInventoryAvailable: visibleIds !== null,
    runs,
    coverageRecomputed,
    valid: runs.every((run) => run.valid) && coverageRecomputed.failures.length === 0,
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        valid: report.valid,
        files: report.files,
        manifestSha256: report.manifestSha256,
        runs: runs.map(({ directory, states, failures }) => ({ directory, states, failures })),
      },
      null,
      2,
    ),
  );
  if (!report.valid) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { verifyRun };
