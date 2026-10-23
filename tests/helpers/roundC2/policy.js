const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { sha } = require('./manifest');
function compareComplete(expected, actual) {
  assert.deepStrictEqual(actual, expected, 'Complete path/hash inventory changed');
}
// Only support tooling unused by these direct Node/container gates may differ.
// All runtime, roundB/C1 harness, shared fixtures, environment/policy and contract
// paths remain in the complete comparison. HTTP/full never use this exception.
const reusableCommands = {
  build: ['node', ['tests/helpers/roundB/build-candidate.js', '--final']],
  runtime: ['node', ['tests/helpers/roundB/close-runtime.js']],
  strict: ['node', ['tests/helpers/roundB/strict-image.js', '--final']],
  phase5: ['node', ['tests/helpers/roundB/phase5.js']],
  faults: ['node', ['tests/helpers/roundB/close-faults.js']],
  code91: ['node', ['tests/helpers/roundB/close-code91.js']],
  workers: [
    'node',
    [
      'tests/helpers/roundB/a1-workers.js',
      '--only',
      'expiry,payment,delivery,notification,security',
    ],
  ],
};
const supportOnly = new Set([
  'jest.config.js',
  'tests/helpers/roundC2/jest-discovery.js',
  'tests/helpers/roundC2/manifest.js',
  'tests/helpers/roundC2/run.js',
  'tests/helpers/roundC2/export.js',
  'tests/helpers/roundC2/policy.js',
  'tests/helpers/roundC2/verify.js',
  'tests/jestDiscovery.test.js',
  'tests/roundC2Verification.test.js',
]);
function assertCompatibleGate(name, previous, current, command, binding) {
  assert(Object.hasOwn(reusableCommands, name), 'Gate requires exact snapshot');
  const [program, args] = reusableCommands[name];
  assert.deepStrictEqual(command, [program, ...args], 'Gate invocation changed');
  assert(binding && binding.gate === name, 'Missing compatibility binding');
  assert.equal(binding.previousManifestSha256, sha(Buffer.from(JSON.stringify(previous))));
  assert.equal(binding.currentManifestSha256, sha(Buffer.from(JSON.stringify(current))));
  const delta = [];
  for (const file of [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort()) {
    if (previous[file] === current[file]) continue;
    assert(supportOnly.has(file), 'Relevant gate path changed: ' + file);
    delta.push({ file, before: previous[file] ?? null, after: current[file] ?? null });
  }
  assert.deepStrictEqual(binding.delta, delta, 'Unreviewed compatibility delta');
  return delta;
}
const approvedSseFile = 'src/controllers/notificationController.js';
const approvedSseSha256 = 'a90bbb36184ae50ff88e1ac4c634f910c306e6c645525bd1ccae7e9860cfdbbc';
function assertApprovedRuntime(checkpoint, current) {
  const protectedFiles = (value) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([file]) =>
          /^(src|scripts|tooling)\//.test(file) ||
          ['package.json', 'package-lock.json', 'Dockerfile'].includes(file),
      ),
    );
  const expected = protectedFiles(checkpoint);
  assert(Object.hasOwn(expected, approvedSseFile), 'Missing checkpoint controller');
  expected[approvedSseFile] = approvedSseSha256;
  compareComplete(expected, protectedFiles(current));
}
function assertWorkers(report, image) {
  assert.equal(report.exitCode, 0);
  assert.equal(report.cleanupExitCode, 0);
  assert.deepStrictEqual(report.counts, { pass: 5, fail: 0, skip: 0, notRun: 0 });
  assert.equal(report.image, image);
  assert.deepStrictEqual(report.cases.map((c) => c.kind).sort(), [
    'delivery',
    'expiry',
    'notification',
    'payment',
    'security',
  ]);
  for (const row of report.cases) {
    assert(row.passed);
    assert.equal(row.cleanupExitCode, 0);
    assert.deepStrictEqual(row.logsGuard, []);
    assert.equal(row.runtime.length, 2);
    assert(row.runtime.every((r) => r.matched && r.image === image));
  }
}
function assertArchiveChain(bytes, backup, runId) {
  const hash = sha(bytes);
  assert.equal(backup.runId, runId);
  assert.equal(backup.archive, 'b07-fixture.archive.gz');
  assert.equal(backup.archiveBytes, bytes.length);
  assert.equal(backup.archiveSha256, hash);
  assert.equal(backup.archiveBeforeRestoreSha256, hash);
  assert.equal(backup.archiveAfterRestoreSha256, hash);
  for (const name of ['before', 'after', 'containerBefore', 'containerAfter'])
    assert.equal(backup.restoreHashes?.[name], hash);
  assert(
    backup.destinationInitiallyEmpty &&
      backup.countsAndIndexes &&
      backup.relations &&
      backup.sessionReplay,
  );
  assert.equal(backup.rpoAcknowledgedWritesLost, 0);
  assert(backup.restoreMs > 0 && backup.observedRtoMs > 0);
  zlib.gunzipSync(bytes);
  return { sha256: hash, bytes: bytes.length, runId };
}
function assertResourceAbsent(resource, inventory) {
  const type = resource.type || 'container';
  assert(['container', 'network', 'volume'].includes(type), 'Unknown resource type');
  assert(resource.owner && resource.name.includes(resource.owner), 'Resource UUID/name mismatch');
  assert(resource.cleaned === true || resource.absent === true, 'Missing resource cleanup record');
  const visible = inventory[type];
  assert(Array.isArray(visible), 'Missing live resource inventory');
  if (type !== 'volume') assert(/^[a-f0-9]{64}$/.test(resource.id), 'Missing exact resource ID');
  assert(
    !visible.some((row) => row.name === resource.name || (resource.id && row.id === resource.id)),
    'Owned resource still present',
  );
}
function assertImportedHarness(expected, observations) {
  assert.deepStrictEqual(Object.keys(expected).sort(), [
    'artifacts/round-b/b06-image-source.txt',
    'artifacts/round-b/factories-image.txt',
  ]);
  for (const [file, hash] of Object.entries(expected)) {
    const copies = observations.filter((row) => row.source === file);
    assert(copies.length > 0, 'Missing imported harness copy evidence');
    for (const copy of copies) {
      assert.equal(copy.exitCode, 0);
      assert.equal(copy.sha256, hash, 'Imported gate harness changed');
    }
  }
}
module.exports = {
  compareComplete,
  assertApprovedRuntime,
  assertWorkers,
  assertArchiveChain,
  assertCompatibleGate,
  assertResourceAbsent,
  assertImportedHarness,
};
