const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { root, run, write, sha, docker } = require('./context');
const { sourceManifest } = require('../../../scripts/evidence-manifest');
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const resources = [];
function collect(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory() && item.name === 'attempts')
      for (const child of fs.readdirSync(file)) collect(path.join(file, child));
    else if (item.isFile() && /^resources-.*\.json$/.test(item.name))
      resources.push(JSON.parse(fs.readFileSync(file)));
  }
}
collect(root);
// This first red resource was observed in retained tool output before per-attempt filenames were introduced.
const firstRedObserved = {
  id: '8ae491ce43a7608985304310591fe288320bdbd921792180f4186c8533311ed9',
  run,
  origin:
    'First red run tool output; original shared resource filename was superseded by green run. Absence independently checked here.',
};
const ids = [...new Set([...resources.map((r) => r.id), firstRedObserved.id].filter(Boolean))];
const volumes = [...new Set(resources.flatMap((r) => r.volumes || []).map((v) => v.name))];
const entry = JSON.parse(fs.readFileSync(path.join(root, 'entry.json')));
const gates = {};
for (const name of ['migration', 'regression', 'identity', 'ops', 'quality']) {
  const pointer = JSON.parse(fs.readFileSync(path.join(root, name + '-latest.json')));
  const result = JSON.parse(fs.readFileSync(path.join(root, pointer.file)));
  assert.equal(result.exitCode, 0, name + ' gate failed');
  gates[name] = { file: pointer.file, exitCode: result.exitCode, counts: result.counts };
}
assert.deepEqual(gates.migration.counts, { pass: 5, fail: 0, skip: 0 });
assert.deepEqual(gates.regression.counts, { pass: 22, fail: 0, skip: 0 });
const backup = JSON.parse(fs.readFileSync(path.join(root, 'backup.json')));
assert.equal(sha(fs.readFileSync(path.join(root, backup.archive))), backup.archiveSha256);
assert(Object.values(backup.hashes).every((h) => h === backup.archiveSha256));
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'watchdog-exit.json'))).exitCode, 0);
const ownerBlock = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .match(/<!-- owner-decision-start -->[\s\S]*?<!-- owner-decision-end -->/)[0];
assert.equal(
  ownerBlock(fs.readFileSync('docs/BE-open-issues.md', 'utf8')),
  ownerBlock(execFileSync('git', ['show', 'HEAD:docs/BE-open-issues.md'], { encoding: 'utf8' })),
);
const currentContainers = docker([
  'ps',
  '-a',
  '--no-trunc',
  '--format',
  '{{.ID}} {{.Names}}',
]).split('\n');
for (const id of ids) {
  assert(/^[a-f0-9]{64}$/.test(id));
  assert(!currentContainers.some((v) => v.split(' ')[0] === id), 'Owned C1 container still exists');
}
const currentVolumes = docker(['volume', 'ls', '--format', '{{.Name}}']).split('\n');
for (const name of volumes) assert(!currentVolumes.includes(name), 'Owned C1 volume still exists');
assert.deepEqual(
  currentContainers.sort(),
  entry.containers.sort(),
  'Original container ID/name inventory changed',
);
const images = docker([
  'images',
  '--no-trunc',
  '--format',
  '{{.Repository}}:{{.Tag}} {{.ID}}',
]).split('\n');
assert.deepEqual(images.sort(), entry.images.sort(), 'Original image inventory changed');
const current = sourceManifest();
for (const [file, hash] of Object.entries(entry.source))
  if (
    file.startsWith('src/') ||
    file.startsWith('tooling/') ||
    file === 'package.json' ||
    file === 'package-lock.json'
  )
    assert.equal(current[file], hash, 'Protected host source/policy changed');
assert.equal(git(['rev-parse', 'HEAD']), entry.head);
const bSeal = 'artifacts/round-b/close/04f4cb65-09a3-40d8-9b35-3d5861f690ca/round-b-seal.json';
const bSealHash = sha(fs.readFileSync(bSeal));
assert.equal(bSealHash, '8bb7e9f19446eaaf1987a959069f5ff02a83752dace10608887a507ea1c34719');
const changed = [
  ...new Set(
    [
      ...git(['diff', '--name-only']).split('\n'),
      ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
    ].filter(Boolean),
  ),
];
const groups = { behavior: [], tooling: [], format: [] };
for (const file of changed) {
  assert(
    file.startsWith('docs/') ||
      file.startsWith('tests/') ||
      file === 'scripts/migrate-commerce-integrity.js',
    'C1 edit outside authorized files',
  );
  const group = file === 'scripts/migrate-commerce-integrity.js' ? 'behavior' : 'tooling';
  const target = path.join(root, 'full-files', group, 'after', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
  let before;
  try {
    before = execFileSync('git', ['show', 'HEAD:' + file], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    /* New file has no HEAD preimage. */
  }
  if (before) {
    const previous = path.join(root, 'full-files', group, 'before', file);
    fs.mkdirSync(path.dirname(previous), { recursive: true });
    fs.writeFileSync(previous, before);
  }
  groups[group].push({
    file,
    afterSha256: sha(fs.readFileSync(file)),
    beforeHeadBlobSha256: before ? sha(before) : null,
  });
}
groups.format = {
  files: JSON.parse(fs.readFileSync(path.join(root, 'format-ast.json'))),
  note: 'Formatter-only before/after full files and AST equality are retained separately at each beforeFile/afterFile under format-passes; no unrelated formatting.',
};
for (const { file } of groups.format.files) {
  const target = path.join(root, 'format-after', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
write('full-file-export.json', groups);
write('final-source.json', current);
const native = JSON.parse(fs.readFileSync(path.join(root, 'native-regression-resource.json')));
assert.equal(native.run, run);
assert.equal(native.closed, true);
assert.equal(native.observation, 'ECONNREFUSED');
write('cleanup.json', {
  run,
  exitCode: 0,
  gates,
  containerIds: ids,
  volumes,
  allListedContainersAbsent: true,
  allListedVolumesAbsent: true,
  originalContainerInventoryUnchanged: true,
  originalImagesUnchanged: true,
  firstRedObserved,
  hostSrcAndPoliciesUnchanged: true,
  headUnchanged: true,
  historicalBSealSha256: bSealHash,
  noNewSeal: true,
  finalNativeRegression: native,
  phase9: false,
  nativeLimit:
    'Jest regression used owned MongoMemoryReplSet and awaited helper teardown; no independent historical OS-wide PID audit claimed.',
});
console.log(
  JSON.stringify({
    exitCode: 0,
    containersAbsent: ids.length,
    volumesAbsent: volumes.length,
    changedFiles: changed.length,
  }),
);
