// Read-only verification of evidence and Docker inventory; writes the seal only on success.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256, compareManifest } = require('../../../scripts/evidence-manifest');
const { verifyRun } = require('../../../scripts/verify-be-evidence');
const { checkCoverage } = require('../../../scripts/check-commerce-coverage');
const root = 'artifacts/round-a';
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split('\n');
}
function main() {
  const [httpDirectory, fullDirectory] = process.argv.slice(2);
  if (!httpDirectory || !fullDirectory)
    throw new Error('Supply HTTP and full evidence directories');
  const failures = [];
  const check = (value, reason) => {
    if (!value) failures.push(reason);
  };
  const manifest = sourceManifest();
  const manifestSha256 = sha256(JSON.stringify(manifest, null, 2) + '\n');
  const preflight = read('phase1-preflight.json');
  const candidate = read('candidate.json');
  const strict = read('phase3-final.json');
  const quality = read('quality-recovery-exit.json');
  const containers = docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']);
  const images = docker([
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]);
  const networks = new Set(docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']));
  const ids = containers.map((line) => line.split(' ')[0]);
  const runs = [
    verifyRun(httpDirectory, { mode: 'http', manifest, visibleIds: ids }),
    verifyRun(fullDirectory, { mode: 'all', manifest, visibleIds: ids }),
  ];
  const coverage = checkCoverage(path.join(fullDirectory, 'coverage'));
  check(
    runs.every((run) => run.valid) && coverage.failures.length === 0,
    'B01/coverage/cleanup verification failed',
  );
  check(read('phase1-verification.json').valid, 'baseline gate failed');
  check(
    preflight.preflightExitCode === 0 && preflight.cleanupExitCode === 0,
    'preflight gate failed',
  );
  const topology = read('phase2.json');
  check(topology.exitCode === 0 && topology.cleanupExitCode === 0, 'topology gate failed');
  check(
    candidate.exitCode === 0 && candidate.buildExitCode === 0 && candidate.cleanupExitCode === 0,
    'candidate gate failed',
  );
  check(
    candidate.sourceManifestSha256 === manifestSha256 &&
      candidate.image.labels['totmart.test.source'] === manifestSha256 &&
      Object.entries(candidate.runtimeSourceHashes).every(
        ([file, hash]) =>
          manifest[file] === hash && candidate.runtime.runtimeSourceHashes[file] === hash,
      ),
    'image/source hashes differ',
  );
  check(
    strict.candidateImage === candidate.image.id &&
      strict.exitCode === 0 &&
      strict.cleanupExitCode === 0 &&
      strict.cases.length === 21 &&
      strict.cases.every((test) => test.passed),
    'strict image gate incomplete/failed',
  );
  const outage = strict.mongoOutage;
  check(
    outage?.requests?.length >= 10 &&
      !outage.unsafeLogContent &&
      outage.requests.every((request) => request.guardFailures?.length === 0),
    'Mongo request evidence incomplete/unsafe',
  );
  for (const mode of ['prod', 'stage']) {
    const login = outage?.requests?.find(
      (request) => request.mode === mode && request.path === '/api/home/login',
    );
    check(
      login?.status === 503 &&
        login.body?.requestId === login.headers?.['x-request-id'] &&
        login.logRequestIds?.includes(login.body.requestId),
      `Mongo ${mode} response/log correlation missing`,
    );
  }
  check(
    quality.lint === 0 && quality['format:check'] === 0 && quality['validate:api'] === 0,
    'quality gate failed',
  );
  // lint:all is an inventory of unchanged historical debt, not a replacement for the changed-file gate.
  check(
    quality['lint:all'] === 1 &&
      /19 problems \(19 errors, 0 warnings\)/.test(
        fs.readFileSync(path.join(root, 'recovery-lint-all.txt'), 'utf8'),
      ),
    'lint debt differs from recorded baseline',
  );
  check(
    sha256(fs.readFileSync('package-lock.json')) === preflight.lockfileSha256,
    'lockfile changed',
  );
  const policyDiff = execFileSync(
    'git',
    [
      'diff',
      'HEAD',
      '--',
      'tooling/lint-baseline.json',
      'tooling/commerce-coverage-baseline.json',
      'tooling/b05-input-lf-hashes.json',
      'eslint.config.cjs',
      '.prettierrc.json',
      'package-lock.json',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  check(policyDiff.length === 0, 'baseline/coverage/format policy changed');
  const originalContainersPreserved = preflight.existingContainers.every((line) =>
    containers.includes(line),
  );
  const originalImageTagsPreserved = preflight.existingImages.every((line) =>
    images.includes(line),
  );
  check(
    originalContainersPreserved && originalImageTagsPreserved,
    'original Docker inventory differs',
  );
  const resources = new Map();
  function collect(value, source) {
    if (!value || typeof value !== 'object') return;
    if (/^[a-f0-9]{64}$/.test(value.id || '') && value.owner && value.name) {
      const type = value.type === 'network' ? 'network' : 'container';
      resources.set(value.id, {
        ...value,
        type,
        source,
        absent: !(type === 'network' ? networks : new Set(ids)).has(value.id),
      });
    } else for (const child of Object.values(value)) collect(child, source);
  }
  for (const file of fs.readdirSync(root)) {
    if (/^(candidate.*|phase1-preflight|.*-resources|mongo-auth-deadline-.*)\.json$/.test(file))
      collect(read(file), `${root}/${file}`);
  }
  for (const directory of [httpDirectory, fullDirectory])
    for (const file of fs.readdirSync(directory))
      if (/resource.*\.json$|^mongo-auth-deadline-.*\.json$/.test(file))
        collect(
          JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')),
          `${directory}/${file}`,
        );
  check(
    resources.size > 0 &&
      [...resources.values()].every((resource) => resource.cleaned === true && resource.absent),
    'owned cleanup incomplete or resource still present',
  );
  const result = {
    recordedAt: new Date().toISOString(),
    valid: failures.length === 0,
    failures,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceCount: Object.keys(manifest).length,
    manifestSha256,
    candidate: candidate.image,
    finalSourceMatchesImage: candidate.sourceManifestSha256 === manifestSha256,
    originalContainersPreserved,
    originalImageTagsPreserved,
    quality,
    strictFinal: {
      passed: strict.cases.filter((test) => test.passed).length,
      failed: strict.cases.filter((test) => !test.passed).length,
      skipped: 0,
      notRun: 21 - strict.cases.length,
      exitCode: strict.exitCode,
      cleanupExitCode: strict.cleanupExitCode,
    },
    finalRuns: runs,
    coverageRecomputed: coverage,
    resources: [...resources.values()],
    ownedContainersAbsent: [...resources.values()].filter(
      (resource) => resource.type === 'container' && resource.absent,
    ).length,
    ownedNetworksAbsent: [...resources.values()].filter(
      (resource) => resource.type === 'network' && resource.absent,
    ).length,
    baselineDelta: compareManifest(read('source-sha256.json'), manifest),
  };
  fs.writeFileSync(
    path.join(root, 'recovery-verifier.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  if (result.valid) {
    fs.writeFileSync(
      path.join(root, 'source-sha256.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    fs.writeFileSync(path.join(root, 'round-a-seal.json'), JSON.stringify(result, null, 2) + '\n');
  }
  console.log(
    JSON.stringify(
      {
        valid: result.valid,
        failures,
        image: candidate.image.id,
        sourceCount: result.sourceCount,
        manifestSha256,
        strict: result.strictFinal,
        runs: runs.map(({ directory, states, exit }) => ({ directory, states, exit })),
        ownedContainersAbsent: result.ownedContainersAbsent,
        ownedNetworksAbsent: result.ownedNetworksAbsent,
      },
      null,
      2,
    ),
  );
  process.exitCode = result.valid ? 0 : 1;
}
try {
  main();
} catch {
  console.error('Round A verifier failed; seal was not regenerated');
  process.exitCode = 1;
}
