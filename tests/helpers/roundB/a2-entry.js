const fs = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceManifest } = require('../../../scripts/evidence-manifest');
const directory = 'artifacts/round-b/a2-0/' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles = [
  'scripts/review-user-identity.js',
  'artifacts/round-a/round-a-seal.json',
  'artifacts/round-a/source-sha256.json',
  'artifacts/round-a/candidate.json',
  'docs/A-verification.md',
];
fs.writeFileSync(
  directory + '/entry.json',
  JSON.stringify(
    {
      cwd: process.cwd(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      status: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
      protectedHashes: Object.fromEntries(protectedFiles.map((file) => [file, hash(file)])),
      source: sourceManifest(),
      containers: execFileSync(
        'docker',
        ['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'],
        { encoding: 'utf8' },
      ),
      images: execFileSync(
        'docker',
        ['image', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}'],
        { encoding: 'utf8' },
      ),
    },
    null,
    2,
  ),
);
fs.writeFileSync('artifacts/round-b/a2-0/current.json', JSON.stringify({ directory }));
console.log(directory);
