const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const directory = 'artifacts/round-b/close/' + randomUUID();
const run = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const protectedFiles = [
  'artifacts/round-a/round-a-seal.json',
  'artifacts/round-a/source-sha256.json',
  'artifacts/round-a/candidate.json',
  'docs/A-verification.md',
  'artifacts/round-b/candidate.json',
  'artifacts/round-b/phase3-final.json',
  'artifacts/round-b/phase5.json',
  'artifacts/round-b/phase6-faults.json',
  'artifacts/round-b/a1/current.json',
  'artifacts/round-b/a2-0/current.json',
];
const entry = {
  directory,
  at: new Date().toISOString(),
  cwd: process.cwd(),
  head: run('git', ['rev-parse', 'HEAD']),
  tag: run('git', ['tag', '--points-at', 'HEAD']),
  status: run('git', ['status', '--short']),
  node: process.version,
  engine: run('docker', ['version', '--format', '{{.Server.Version}}']),
  containers: run('docker', ['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'])
    .split('\n')
    .filter(Boolean),
  images: run('docker', [
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ])
    .split('\n')
    .filter(Boolean),
  protectedHashes: Object.fromEntries(
    protectedFiles.map((file) => [file, sha256(fs.readFileSync(file))]),
  ),
  source: sourceManifest(),
  candidate: JSON.parse(fs.readFileSync('artifacts/round-b/candidate.json')),
};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(directory + '/entry.json', JSON.stringify(entry, null, 2));
fs.writeFileSync('artifacts/round-b/close/current.json', JSON.stringify({ directory }));
console.log(
  JSON.stringify({
    directory,
    head: entry.head,
    engine: entry.engine,
    originalContainers: entry.containers.length,
  }),
);
