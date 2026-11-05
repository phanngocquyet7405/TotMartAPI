const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { sourceManifest, compareManifest, sha256 } = require('../scripts/evidence-manifest');
const { verifyRun } = require('../scripts/verify-be-evidence');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totmart-evidence-'));
});
afterEach(() => {
  if (
    !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
    !path.basename(root).startsWith('totmart-evidence-')
  )
    throw new Error('Fixture cleanup target mismatch');
  fs.rmSync(root, { recursive: true });
});
function json(file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
}
function fixture() {
  const manifest = { 'src/example.js': sha256('example') };
  json('source-sha256.json', manifest);
  json('exit.json', {
    mode: 'all',
    node: 'v24.14.1',
    jestExitCode: 0,
    runnerExitCode: 0,
    cleanupExitCode: 0,
    coverageExitCode: 0,
  });
  json('jest.json', {
    success: true,
    numPassedTests: 1,
    numTotalTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numPassedTestSuites: 1,
    numTotalTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    suites: [{ status: 'passed', tests: [{ name: 'fixture', status: 'passed' }] }],
  });
  json('coverage/coverage-summary.json', { total: {} });
  fs.writeFileSync(path.join(root, 'coverage/lcov.info'), 'fixture');
  json('commerce-coverage-gate.json', { policy: 1, modules: 8, failures: [] });
  const resource = {
    id: 'a'.repeat(64),
    owner: 'fixture-owner',
    name: 'fixture-name',
    cleaned: true,
  };
  for (const file of ['primitives-resource.json', 'http-resource.json', 'server-resource.json'])
    json(file, resource);
  json('b07-resources.json', { mongo: resource, redis: resource });
  const archive = gzipSync('synthetic fixture only'),
    hash = sha256(archive);
  fs.writeFileSync(path.join(root, 'b07-fixture.archive.gz'), archive);
  json('b07-evidence.json', [
    {
      scenario: 'backup-restore',
      runId: path.basename(root),
      archive: 'b07-fixture.archive.gz',
      archiveBytes: archive.length,
      archiveSha256: hash,
      archiveBeforeRestoreSha256: hash,
      archiveAfterRestoreSha256: hash,
      restoreHashes: { before: hash, after: hash, containerBefore: hash, containerAfter: hash },
      destinationInitiallyEmpty: true,
      countsAndIndexes: true,
      relations: true,
      sessionReplay: true,
    },
  ]);
  return { mode: 'all', manifest, visibleIds: [] };
}
test('complete fixture passes and hashes archive bytes directly', () => {
  expect(verifyRun(root, fixture()).valid).toBe(true);
  const bytes = Buffer.from([0, 255, 1]);
  expect(sha256(bytes)).toBe(
    require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
  );
});
test('manifest detects added, missing and modified source including untracked files', () => {
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/original.js'), 'before');
  const before = sourceManifest(root, ['src'], []);
  fs.unlinkSync(path.join(root, 'src/original.js'));
  fs.writeFileSync(path.join(root, 'src/new.js'), 'new');
  expect(compareManifest(before, sourceManifest(root, ['src'], []))).toEqual({
    added: ['src/new.js'],
    missing: ['src/original.js'],
    changed: [],
  });
  fs.writeFileSync(path.join(root, 'src/original.js'), 'after');
  expect(compareManifest(before, sourceManifest(root, ['src'], [])).changed).toEqual([
    'src/original.js',
  ]);
});
test.each([
  'b07-fixture.archive.gz',
  'b07-evidence.json',
  'source-sha256.json',
  'exit.json',
  'jest.json',
  'coverage/coverage-summary.json',
  'coverage/lcov.info',
  'commerce-coverage-gate.json',
  'primitives-resource.json',
  'http-resource.json',
  'server-resource.json',
  'b07-resources.json',
])('missing required artifact %s fails', (file) => {
  const options = fixture();
  fs.unlinkSync(path.join(root, file));
  expect(verifyRun(root, options).valid).toBe(false);
});
test('archive mismatch fails without touching historical archive', () => {
  const options = fixture();
  fs.writeFileSync(
    path.join(root, 'b07-fixture.archive.gz'),
    gzipSync('different synthetic fixture'),
  );
  expect(verifyRun(root, options).failures).toContain('archive checksum/restore chain mismatch');
});
test.each(['runId', 'archiveBeforeRestoreSha256', 'archiveAfterRestoreSha256', 'restoreHashes'])(
  'missing or inconsistent restore chain field %s fails',
  (key) => {
    const options = fixture(),
      file = path.join(root, 'b07-evidence.json');
    const evidence = JSON.parse(fs.readFileSync(file));
    delete evidence[0][key];
    json('b07-evidence.json', evidence);
    expect(verifyRun(root, options).valid).toBe(false);
  },
);
test.each(['jestExitCode', 'runnerExitCode', 'cleanupExitCode', 'coverageExitCode'])(
  'nonzero separate exit %s fails even when counts pass',
  (key) => {
    const options = fixture(),
      exit = JSON.parse(fs.readFileSync(path.join(root, 'exit.json')));
    exit[key] = 1;
    json('exit.json', exit);
    expect(verifyRun(root, options).valid).toBe(false);
  },
);
test('claimed counts cannot hide a failed assertion', () => {
  const options = fixture(),
    jest = JSON.parse(fs.readFileSync(path.join(root, 'jest.json')));
  jest.suites[0].tests[0].status = 'failed';
  json('jest.json', jest);
  expect(verifyRun(root, options).valid).toBe(false);
});
test('new source outside recorded manifest fails', () => {
  const options = fixture();
  options.manifest['src/extra.js'] = sha256('new');
  expect(verifyRun(root, options).valid).toBe(false);
});
test.each([null, ['a'.repeat(64)]])(
  'unavailable inventory or present resource fails: %j',
  (visibleIds) => {
    const options = fixture();
    options.visibleIds = visibleIds;
    expect(verifyRun(root, options).valid).toBe(false);
  },
);
