const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const reports = new Set(['docs/C2-verification.md', 'docs/BE-release-candidate.md']);
function manifest() {
  const files = {};
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.posix.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('Manifest symlink refused');
      if (/^\.env(?:\.|$)/.test(item.name))
        throw Error('Sensitive file in candidate scope; refusing to read');
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) files[file] = sha(fs.readFileSync(file));
    }
  }
  for (const dir of ['src', 'tests', 'scripts', 'tooling', '.github', 'docs']) walk(dir);
  for (const file of [
    'AGENTS.md',
    'package.json',
    'package-lock.json',
    'Dockerfile',
    '.dockerignore',
    '.gitignore',
    '.prettierrc.json',
    'jest.config.js',
    'eslint.config.cjs',
    'README.md',
    'OPERATIONS.md',
    'compose.redis-test.yml',
  ])
    if (fs.existsSync(file)) files[file] = sha(fs.readFileSync(file));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const executable = (value) =>
  Object.fromEntries(Object.entries(value).filter(([file]) => !reports.has(file)));
function filesIn(root) {
  const out = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('Evidence symlink refused');
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) out.push(file);
    }
  }
  walk(root);
  return out;
}
const importedHarnessFiles = [
  'artifacts/round-b/b06-image-source.txt',
  'artifacts/round-b/factories-image.txt',
];
function harnessInputs() {
  return Object.fromEntries(importedHarnessFiles.map((file) => [file, sha(fs.readFileSync(file))]));
}
function importedEvidence(directory) {
  return filesIn(directory)
    .filter((file) => file.endsWith('-resources.json'))
    .flatMap((file) => {
      const bytes = fs.readFileSync(file);
      return (JSON.parse(bytes).commands || [])
        .filter((op) => importedHarnessFiles.includes(op.source))
        .map((op) => ({
          file,
          fileSha256: sha(bytes),
          source: op.source,
          sha256: op.sha256,
          exitCode: op.exitCode,
        }));
    });
}
function resourceEvidence(directory) {
  // File names do not define resource scope: auth deadline uses a different name.
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file))));
}
function resourceDescriptors(value) {
  if (!value || typeof value !== 'object') return [];
  const own =
    value.name && (value.owner || value.run) && (value.id || value.type === 'volume')
      ? [value]
      : [];
  return [...own, ...Object.values(value).flatMap(resourceDescriptors)];
}
module.exports = {
  manifest,
  executable,
  sha,
  filesIn,
  harnessInputs,
  importedEvidence,
  resourceEvidence,
  resourceDescriptors,
};
