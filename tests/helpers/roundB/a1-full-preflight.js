// Read-only authorization preflight. Never changes tests or runs migration.
const fs = require('node:fs');
const { sha256 } = require('../../../scripts/evidence-manifest');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const file = 'tests/identityMigrationB03.test.js';
const source = fs.readFileSync(file, 'utf8');
const names = ['legacy_custom_display', 'custom_display_desc'];
if (!names.every((name) => source.includes(name)) || !source.includes('applyDisposable(db,plan)'))
  throw Error('Preflight source changed; investigate exact workflows before running full');
const result = {
  command: 'npm run test:b01',
  status: 'BLOCKED',
  started: false,
  preflightExitCode: 2,
  jestExitCode: null,
  runnerExitCode: null,
  coverageExitCode: null,
  cleanupExitCode: null,
  counts: { pass: 0, fail: 0, skip: 0, notRun: 'entire full gate' },
  classification: 'authorization constraint; no application assertion executed',
  reason:
    'The sole approved exception is cleanup of b03_owned_legacy_display_fixture. Full also executes migration index drops outside that exception.',
  evidence: {
    test: file,
    testSha256: sha256(Buffer.from(source)),
    applier: 'scripts/review-user-identity.js',
    applierSha256: sha256(fs.readFileSync('scripts/review-user-identity.js')),
    entry: 'applyDisposable',
    operation: 'collection.dropIndex(index.name)',
    names,
  },
  noTestsSkippedOrAssertionsChanged: true,
  coveragePolicyChanged: false,
};
fs.writeFileSync(root + '/b01-full-preflight.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = 2;
