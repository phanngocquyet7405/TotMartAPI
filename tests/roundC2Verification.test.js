const zlib = require('node:zlib');
const { sha } = require('./helpers/roundC2/manifest');
const {
  compareComplete,
  assertApprovedRuntime,
  assertWorkers,
  assertArchiveChain,
  assertCompatibleGate,
  assertResourceAbsent,
  assertImportedHarness,
} = require('./helpers/roundC2/policy');
const { resourceEvidence, resourceDescriptors } = require('./helpers/roundC2/manifest');
const { exportGroup, logicalText } = require('./helpers/roundC2/export');

function compatibility(previous, current) {
  return {
    gate: 'strict',
    previousManifestSha256: sha(Buffer.from(JSON.stringify(previous))),
    currentManifestSha256: sha(Buffer.from(JSON.stringify(current))),
    delta: [...new Set([...Object.keys(previous), ...Object.keys(current)])]
      .sort()
      .filter((file) => previous[file] !== current[file])
      .map((file) => ({ file, before: previous[file] ?? null, after: current[file] ?? null })),
  };
}
const strictCommand = ['node', 'tests/helpers/roundB/strict-image.js', '--final'];
test('C2 discovers auth deadline resources independently of the JSON filename', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totmart-resource-discovery-'));
  if (
    path.dirname(dir) !== os.tmpdir() ||
    !path.basename(dir).startsWith('totmart-resource-discovery-')
  )
    throw new Error('Fixture cleanup mismatch');
  const resource = {
    id: 'c'.repeat(64),
    name: 'totmart-fixture-owner-mongo',
    owner: 'fixture-owner',
    cleaned: true,
    port: 12345,
  };
  try {
    fs.writeFileSync(
      path.join(dir, 'mongo-auth-deadline-fixture.json'),
      JSON.stringify({ resource }),
    );
    fs.writeFileSync(path.join(dir, 'jest.json'), JSON.stringify({ success: true }));
    const found = resourceEvidence(dir).flatMap(resourceDescriptors);
    expect(found).toEqual([resource]);
    expect(() =>
      assertResourceAbsent(found[0], { container: [{ id: resource.id, name: resource.name }] }),
    ).toThrow('still present');
    expect(() => assertResourceAbsent(found[0], { container: [] })).not.toThrow();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test.each(['valid', 'missing', 'changed', 'failed-copy'])(
  'C2 imported harness linkage: %s',
  (kind) => {
    const inputs = {
      'artifacts/round-b/b06-image-source.txt': 'one',
      'artifacts/round-b/factories-image.txt': 'two',
    };
    const observations = Object.entries(inputs).map(([source, sha256]) => ({
      source,
      sha256,
      exitCode: 0,
    }));
    if (kind === 'missing') observations.pop();
    if (kind === 'changed') observations[0].sha256 = 'different';
    if (kind === 'failed-copy') observations[0].exitCode = 1;
    if (kind === 'valid') expect(() => assertImportedHarness(inputs, observations)).not.toThrow();
    else expect(() => assertImportedHarness(inputs, observations)).toThrow();
  },
);
test.each(['container', 'network', 'volume'])('C2 checks exact live %s absence', (type) => {
  const resource = {
    type,
    id: 'a'.repeat(64),
    name: 'test-fixture-owner-resource',
    owner: 'fixture-owner',
    cleaned: true,
  };
  const inventory = { [type]: [] };
  expect(() => assertResourceAbsent(resource, inventory)).not.toThrow();
  for (const row of [
    { id: resource.id, name: 'different' },
    { id: 'b'.repeat(64), name: resource.name },
  ]) {
    if (type === 'volume' && row.name === 'different') continue;
    expect(() => assertResourceAbsent(resource, { [type]: [row] })).toThrow('still present');
  }
  expect(() => assertResourceAbsent(resource, {})).toThrow();
  expect(() => assertResourceAbsent({ ...resource, cleaned: false }, inventory)).toThrow();
});
test('C2 reuses only direct gates with exact support-tool delta binding', () => {
  const previous = { 'src/app.js': 'same', 'jest.config.js': 'old' };
  const current = { 'src/app.js': 'same', 'jest.config.js': 'new' };
  expect(
    assertCompatibleGate(
      'strict',
      previous,
      current,
      strictCommand,
      compatibility(previous, current),
    ),
  ).toHaveLength(1);
});
test.each([
  'tests/helpers/roundB/client.js',
  'tests/helpers/db.js',
  'tests/checkout.test.js',
  'src/app.js',
  'scripts/run-be-tests.js',
  'tooling/commerce-coverage-baseline.json',
  'package-lock.json',
  'docs/FE-BE-contract-handoff.md',
  'tests/new.test.js',
])('C2 refuses changed/added/missing relevant path %s even with claimed binding', (file) => {
  for (const kind of ['changed', 'added', 'missing']) {
    const previous = kind === 'added' ? {} : { [file]: 'old' };
    const current = kind === 'missing' ? {} : { [file]: 'new' };
    expect(() =>
      assertCompatibleGate(
        'strict',
        previous,
        current,
        strictCommand,
        compatibility(previous, current),
      ),
    ).toThrow('Relevant');
  }
});
test.each(['full', 'http', 'lint', 'unknown'])('C2 refuses compatibility for %s', (name) => {
  expect(() => assertCompatibleGate(name, {}, {}, strictCommand, compatibility({}, {}))).toThrow();
});
test.each(['invocation', 'binding', 'hash', 'delta'])('C2 refuses incompatible %s', (kind) => {
  const previous = { 'jest.config.js': 'old' },
    current = { 'jest.config.js': 'new' };
  const binding = compatibility(previous, current),
    command = [...strictCommand];
  if (kind === 'invocation') command.push('--skip');
  if (kind === 'binding') binding.gate = 'full';
  if (kind === 'hash') binding.currentManifestSha256 = 'bad';
  if (kind === 'delta') binding.delta[0].after = 'bad';
  expect(() => assertCompatibleGate('strict', previous, current, command, binding)).toThrow();
});
test.each([
  'jest.config.js',
  'scripts/verify-be-evidence.js',
  'tests/helpers/roundC2/jest-discovery.js',
])('exporter accepts authorized tooling %s', (file) => {
  expect(exportGroup(file)).toBe('tooling');
});
test.each(['src/app.js', '.env', 'tests/.env.secret', 'package.json', 'scripts/new-runtime.js'])(
  'exporter refuses unapproved path %s',
  (file) => {
    expect(() => exportGroup(file)).toThrow();
  },
);
test('exporter keeps semantic edits out of the format patch', () => {
  expect(logicalText('tests/a.js', 'const x=1;', 'const x = 2;')).toBe('const x = 2;');
  expect(logicalText('tests/a.js', 'const x=1;', 'const x = 1;')).toBe('const x=1;');
  expect(logicalText('docs/a.md', 'old', 'new')).toBe('new');
});

const approvedController = 'src/controllers/notificationController.js';
const approvedHash = 'a90bbb36184ae50ff88e1ac4c634f910c306e6c645525bd1ccae7e9860cfdbbc';
test('C2 permits only the owner-approved SSE runtime fingerprint', () => {
  expect(() =>
    assertApprovedRuntime(
      { [approvedController]: 'checkpoint', 'src/app.js': 'same' },
      { [approvedController]: approvedHash, 'src/app.js': 'same' },
    ),
  ).not.toThrow();
});
test.each(['changed-approved', 'changed-other', 'added', 'missing', 'missing-checkpoint'])(
  'C2 rejects unapproved runtime %s',
  (kind) => {
    const checkpoint = { [approvedController]: 'checkpoint', 'src/app.js': 'same' };
    const current = { [approvedController]: approvedHash, 'src/app.js': 'same' };
    if (kind === 'changed-approved') current[approvedController] = 'different-fix';
    if (kind === 'changed-other') current['src/app.js'] = 'different';
    if (kind === 'added') current['src/new.js'] = 'new';
    if (kind === 'missing') delete current['src/app.js'];
    if (kind === 'missing-checkpoint') delete checkpoint[approvedController];
    expect(() => assertApprovedRuntime(checkpoint, current)).toThrow();
  },
);
test.each(['added', 'missing', 'changed'])('C2 complete inventory rejects %s source', (kind) => {
  const before = { 'src/a.js': 'hash' },
    after = { ...before };
  if (kind === 'added') after['tests/new.js'] = 'new';
  if (kind === 'missing') delete after['src/a.js'];
  if (kind === 'changed') after['src/a.js'] = 'other';
  expect(() => compareComplete(before, after)).toThrow();
});
function archive() {
  const bytes = zlib.gzipSync(Buffer.from('Synthetic verifier fixture, not a restore experiment'));
  const hash = sha(bytes);
  return {
    bytes,
    backup: {
      runId: 'run',
      archive: 'b07-fixture.archive.gz',
      archiveBytes: bytes.length,
      archiveSha256: hash,
      archiveBeforeRestoreSha256: hash,
      archiveAfterRestoreSha256: hash,
      restoreHashes: { before: hash, after: hash, containerBefore: hash, containerAfter: hash },
      destinationInitiallyEmpty: true,
      countsAndIndexes: true,
      relations: true,
      sessionReplay: true,
      rpoAcknowledgedWritesLost: 0,
      restoreMs: 1,
      observedRtoMs: 2,
    },
  };
}
test('C2 archive gate checks raw bytes plus full retained-file chain', () => {
  const f = archive();
  expect(assertArchiveChain(f.bytes, f.backup, 'run').sha256).toBe(sha(f.bytes));
});
test.each(['bytes', 'run', 'chain', 'empty'])('C2 archive gate refuses %s mismatch', (kind) => {
  const f = archive();
  if (kind === 'bytes') f.bytes = Buffer.from('wrong');
  if (kind === 'run') f.backup.runId = 'old';
  if (kind === 'chain') f.backup.restoreHashes.containerAfter = 'wrong';
  if (kind === 'empty') f.backup.destinationInitiallyEmpty = false;
  expect(() => assertArchiveChain(f.bytes, f.backup, 'run')).toThrow();
});
function workers() {
  return {
    exitCode: 0,
    cleanupExitCode: 0,
    image: 'image',
    counts: { pass: 5, fail: 0, skip: 0, notRun: 0 },
    cases: ['delivery', 'expiry', 'notification', 'payment', 'security'].map((kind) => ({
      kind,
      passed: true,
      cleanupExitCode: 0,
      logsGuard: [],
      runtime: Array.from({ length: 2 }, () => ({ matched: true, image: 'image' })),
    })),
  };
}
test('C2 worker gate accepts five complete real-evidence rows', () => {
  expect(() => assertWorkers(workers(), 'image')).not.toThrow();
});
test.each(['missing', 'runtime', 'cleanup'])('C2 worker gate refuses %s evidence', (kind) => {
  const f = workers();
  if (kind === 'missing') f.cases.pop();
  if (kind === 'runtime') f.cases[0].runtime[0].matched = false;
  if (kind === 'cleanup') f.cases[0].cleanupExitCode = 1;
  expect(() => assertWorkers(f, 'image')).toThrow();
});
