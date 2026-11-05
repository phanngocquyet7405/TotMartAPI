const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const directory = 'artifacts/round-b/a1/' + randomUUID();
fs.mkdirSync(directory + '/before', { recursive: true });
const files = ['src/services/checkoutLifecycle.js', 'src/services/checkoutAttemptService.js'];
for (const file of files)
  fs.copyFileSync(file, directory + '/before/' + file.replaceAll('/', '__') + '.txt');
const historical = [
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
      lockHash: sha256(fs.readFileSync('package-lock.json')),
      historicalHashes: Object.fromEntries(historical.map((f) => [f, sha256(fs.readFileSync(f))])),
      candidate: JSON.parse(fs.readFileSync('artifacts/round-b/candidate.json')),
    },
    null,
    2,
  ),
);
fs.writeFileSync(directory + '/source-before.json', JSON.stringify(sourceManifest(), null, 2));
fs.writeFileSync('artifacts/round-b/a1/current.json', JSON.stringify({ directory }));
console.log(directory);
