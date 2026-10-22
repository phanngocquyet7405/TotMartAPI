// Integrity/absence verifier for a stopped round. Never emits a success seal.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const root = 'artifacts/round-b';
const entry = JSON.parse(fs.readFileSync(root + '/entry-current.json'));
const report = {
  roundBPassed: false,
  sealGenerated: false,
  commands: [],
  gate: 'STOP: unclassified Mongo checkout outcome in Phase 6',
};
const read = (file) => JSON.parse(fs.readFileSync(file));
function command(program, args) {
  try {
    const value = execFileSync(program, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    report.commands.push({ program, operation: args[0], exitCode: 0 });
    return value;
  } catch {
    report.commands.push({ program, operation: args[0], exitCode: 1 });
    throw Error('Read-only verification command failed');
  }
}
try {
  report.head = command('git', ['rev-parse', 'HEAD']);
  assert.equal(report.head, entry.head);
  assert.equal(command('git', ['rev-parse', 'round-a-checkpoint']), report.head);
  report.historicalA = Object.fromEntries(
    Object.entries(entry.historicalA).map(([file, expected]) => [
      file,
      {
        expected,
        actual: sha256(fs.readFileSync(file)),
        unchanged: sha256(fs.readFileSync(file)) === expected,
      },
    ]),
  );
  assert(Object.values(report.historicalA).every((value) => value.unchanged));
  report.engineVersion = command('docker', ['version', '--format', '{{.Server.Version}}']);
  const containers = command('docker', [
    'ps',
    '-a',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Names}}',
  ]).split('\n');
  const networks = command('docker', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split(
    '\n',
  );
  report.originalContainers = entry.existingContainers.map((identity) => ({
    identity,
    present: containers.includes(identity),
  }));
  assert(report.originalContainers.every((value) => value.present));
  const images = command('docker', [
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]).split('\n');
  report.originalImages = {
    count: entry.existingImages.length,
    unchanged: entry.existingImages.every((identity) => images.includes(identity)),
  };
  assert(report.originalImages.unchanged);
  const owned = new Map();
  for (const name of fs.readdirSync(root).filter((name) => name.endsWith('-resources.json'))) {
    const value = read(root + '/' + name);
    for (const resource of value.resources || []) {
      assert.equal(resource.owner, value.run);
      assert(resource.cleaned && resource.absent);
      owned.set(resource.id, {
        id: resource.id,
        type: resource.type,
        run: value.run,
        name: resource.name,
      });
    }
  }
  for (const stage of ['red', 'green']) {
    const dir = root + '/deadline-' + stage;
    if (!fs.existsSync(dir)) continue;
    for (const name of fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('mongo-auth-deadline-') && name.endsWith('.json'))) {
      const resource = read(dir + '/' + name).resource;
      assert(resource.cleaned && resource.absent);
      owned.set(resource.id, {
        id: resource.id,
        type: 'container',
        run: resource.owner,
        name: resource.name,
      });
    }
  }
  const candidate = read(root + '/candidate.json');
  owned.set(candidate.probe.id, {
    id: candidate.probe.id,
    type: 'container',
    run: candidate.run,
    name: candidate.probe.name,
  });
  report.resourceAbsence = [...owned.values()].map((resource) => ({
    ...resource,
    absent:
      resource.type === 'network'
        ? !networks.includes(resource.id)
        : !containers.some((line) => line.startsWith(resource.id + ' ')),
  }));
  assert(report.resourceAbsence.every((resource) => resource.absent));
  report.candidate = {
    image: candidate.image.id,
    digests: candidate.image.digests,
    retainedForReview: true,
  };
  assert.equal(
    command('docker', ['image', 'inspect', '--format', '{{.Id}}', candidate.image.id]),
    candidate.image.id,
  );
  const manifest = sourceManifest();
  fs.writeFileSync(root + '/source-current.json', JSON.stringify(manifest, null, 2) + '\n');
  report.sourceSha256 = sha256(JSON.stringify(manifest, null, 2) + '\n');
  const tracked = execFileSync('git', ['diff', '--name-only', '-z'], { encoding: 'utf8' }).split(
    '\0',
  );
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  }).split('\0');
  const files = [...new Set([...tracked, ...untracked])]
    .filter((file) => /^(src|tests|docs)\//.test(file) && /\.(js|cjs|md)$/.test(file))
    .sort();
  report.fullFiles = [];
  for (const file of files) {
    const destination = root + '/full-files-current/' + file + '.txt';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(destination, bytes);
    report.fullFiles.push({
      source: file,
      export: destination,
      sha256: sha256(bytes),
      verified: sha256(fs.readFileSync(destination)) === sha256(bytes),
    });
  }
  assert(report.fullFiles.every((value) => value.verified));
  // Separate complete behavior snapshots from tooling. No format-only patch exists.
  for (const [group, files] of Object.entries({
    'behavior-1': ['src/app.js', 'src/utils/logger.js'],
    'behavior-2': [
      'src/middleware/errorHandler.js',
      'src/utils/safeErrorSerializer.js',
      'tests/errorDisclosure.test.js',
      'tests/authMongoDeadline.integration.test.js',
      'docs/FE-BE-contract-handoff.md',
    ],
    tooling: report.fullFiles
      .map((value) => value.source)
      .filter(
        (file) =>
          file.startsWith('tests/helpers/') ||
          file === 'tests/roundBLogGuard.test.js' ||
          file === 'docs/B-verification.md',
      ),
  })) {
    for (const file of files) {
      const destination = root + '/patch-groups/' + group + '/' + file + '.txt';
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
    }
  }
  fs.copyFileSync(
    root + '/behavior-1-safeErrorSerializer.js.txt',
    root + '/patch-groups/behavior-1/src/utils/safeErrorSerializer.js.txt',
  );
  report.quality = read(root + '/quality-current.json').map(({ command, exitCode }) => ({
    command,
    exitCode,
  }));
  report.phase5 = read(root + '/phase5.json').counts;
  const strict = read(root + '/phase3-final.json');
  report.strict = {
    passed: strict.cases.filter((value) => value.passed).length,
    failed: strict.cases.filter((value) => !value.passed).length,
    exitCode: strict.exitCode,
    cleanupExitCode: strict.cleanupExitCode,
  };
  report.phase6 = read(root + '/phase6-faults.json').counts;
  report.notRun = [
    'post-behavior Phase5 regression',
    'test:b01:http',
    'test:b01',
    'remaining image workers/fault scenarios',
    'PROD required topology-specific fault proofs',
  ];
  report.exitCode = 0;
} catch (error) {
  report.exitCode = 1;
  report.failure = error.message;
  process.exitCode = 1;
}
const output = root + '/delivery-verification.json';
if (fs.existsSync(output) && !fs.existsSync(root + '/delivery-verification-before-current.json'))
  fs.copyFileSync(output, root + '/delivery-verification-before-current.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    exitCode: report.exitCode,
    roundBPassed: false,
    sealGenerated: false,
    originalContainers: report.originalContainers,
    originalImages: report.originalImages,
    checkedAbsent: report.resourceAbsence?.length,
    fullFiles: report.fullFiles?.length,
    failure: report.failure,
  }),
);
