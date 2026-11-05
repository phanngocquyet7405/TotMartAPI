// C2 seal is derived from raw gate artifacts, complete manifests and live absence checks.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { root, read, write, step } = require('./context');
const {
  manifest,
  executable,
  sha,
  filesIn,
  harnessInputs,
  importedEvidence,
  resourceEvidence,
  resourceDescriptors,
} = require('./manifest');
const {
  compareComplete,
  assertApprovedRuntime,
  assertWorkers,
  assertArchiveChain,
  assertCompatibleGate,
  assertResourceAbsent,
  assertImportedHarness,
} = require('./policy');
const { sourceManifest } = require('../../../scripts/evidence-manifest');
const { evaluate } = require('../roundB/close-policy');
const mode = process.argv[2];
const run = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const excluded = new Set([
  'c2-seal.json',
  'final-source.json',
  'final-evidence.json',
  'verification.json',
]);
async function verify() {
  const entry = read(root + '/entry.json'),
    snapshot = read(root + '/snapshot.json'),
    current = manifest();
  const contract = read(root + '/contract-manifest.json');
  assert.equal(contract.version, 'C2-20261022.1');
  assert.equal(contract.head, entry.head);
  for (const [file, hash] of Object.entries(contract.files))
    assert.equal(current[file], hash, 'Contract fingerprint changed');
  assert.equal(run('git', ['rev-parse', 'HEAD']), entry.head);
  assert.equal(snapshot.head, entry.head);
  compareComplete(snapshot.executable, executable(current));
  compareComplete(snapshot.importedHarness, harnessInputs());
  for (const [file, hash] of Object.entries(entry.protectedHashes))
    assert.equal(sha(fs.readFileSync(file)), hash, 'Historical artifact changed');
  // Owner approved exactly the SSE read-budget patch, fingerprinted before this final run.
  // Every other runtime/policy path and byte must still match the checkpoint inventory.
  assertApprovedRuntime(entry.source, current);
  const names = [
    'ci',
    'build',
    'runtime',
    'strict',
    'phase5',
    'faults',
    'code91',
    'workers',
    'http',
    'full',
    'lint',
    'lintall',
    'format',
    'api',
    'verifier-tests',
  ];
  const steps = Object.fromEntries(names.map((n) => [n, step(n)]));
  const linkage = read(root + '/snapshot-linkage.json');
  assert.equal(linkage.snapshotSha256, sha(fs.readFileSync(root + '/snapshot.json')));
  for (const name of names.filter((n) => n !== 'lintall'))
    assert.equal(steps[name].command.exitCode, 0, name + ' failed');
  for (const name of ['phase5', 'faults', 'code91', 'workers']) {
    const observed = importedEvidence(steps[name].directory);
    compareComplete(linkage.bindings[name].importedHarnessEvidence, observed);
    assertImportedHarness(snapshot.importedHarness, observed);
  }
  for (const name of [
    'build',
    'runtime',
    'strict',
    'phase5',
    'faults',
    'code91',
    'workers',
    'http',
    'full',
    'lint',
    'lintall',
    'format',
    'api',
    'verifier-tests',
  ]) {
    const command = steps[name].command;
    if (JSON.stringify(snapshot.executable) === JSON.stringify(command.executableManifest)) {
      compareComplete(snapshot.executable, command.executableManifest);
      if (command.beforeManifest) compareComplete(snapshot.executable, command.beforeManifest);
    } else {
      const binding = linkage.bindings[name];
      assert(binding, 'Missing gate/snapshot linkage: ' + name);
      assert.equal(
        binding.previousCommandSha256,
        sha(fs.readFileSync(path.join(steps[name].directory, 'command.json'))),
      );
      assertCompatibleGate(
        name,
        command.executableManifest,
        snapshot.executable,
        command.command,
        binding,
      );
    }
  }
  const load = (name, file) => read(path.join(steps[name].directory, file));
  function b01(name) {
    assert.equal(steps[name].command.b01Directories.length, 1);
    const directory = path.resolve('artifacts/b01', steps[name].command.b01Directories[0]);
    assert(directory.startsWith(path.resolve('artifacts/b01') + path.sep));
    return {
      directory,
      exit: read(directory + '/exit.json'),
      jest: read(directory + '/jest.json'),
      ...(name === 'full' ? { coverage: read(directory + '/commerce-coverage-gate.json') } : {}),
    };
  }
  const raw = fs.readFileSync(root + '/owner-provided.txt', 'utf8').trimEnd();
  const quoted = fs
    .readFileSync('docs/BE-open-issues.md', 'utf8')
    .replace(/\r\n/g, '\n')
    .match(
      /<!-- owner-decision-start -->\n```text\n([\s\S]*?)\n```\n<!-- owner-decision-end -->/,
    )[1];
  const http = b01('http'),
    full = b01('full');
  for (const [name, gate] of [
    ['http', http],
    ['full', full],
  ]) {
    const discovery = load(name, 'discovery.json');
    assert.equal(discovery.mode, name === 'full' ? 'all' : 'http');
    assert.equal(discovery.runnerSuitesMatched, true);
    const actual = require('./jest-discovery').assertCanonicalDiscovery(
      gate.jest.suites.map((s) => s.file),
      { mode: discovery.mode },
    );
    compareComplete(actual.suiteFiles, discovery.suiteFiles);
  }
  const input = {
    owner: { raw, quoted },
    commands: Object.fromEntries(names.map((n) => [n, steps[n].command.exitCode])),
    build: read(root + '/candidate.json'),
    runtime: load('runtime', 'runtime.json'),
    strict: load('strict', 'phase3-final.json'),
    phase5: load('phase5', 'phase5.json'),
    faults: load('faults', 'faults.json'),
    code91: load('code91', 'code91.json'),
    http,
    full,
  };
  evaluate(input);
  compareComplete(
    Object.fromEntries(
      Object.entries(sourceManifest()).filter(
        ([f]) => /^(src|scripts)\//.test(f) || ['package.json', 'package-lock.json'].includes(f),
      ),
    ),
    input.runtime.runtime.files,
  );
  const workersRoot = path.resolve(
    fs.readFileSync(steps.workers.directory + '/workers-latest.txt', 'utf8'),
  );
  assert(workersRoot.startsWith(steps.workers.directory + path.sep));
  const workers = read(workersRoot + '/report.json');
  assertWorkers(workers, input.build.image.id);
  const containerLines = run('docker', [
      'ps',
      '-a',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Names}}',
    ]).split('\n'),
    containers = new Set(containerLines.map((l) => l.split(' ')[0])),
    networkLines = run('docker', [
      'network',
      'ls',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Name}}',
    ]).split('\n'),
    volumes = new Set(run('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n'));
  assert(entry.containers.every((l) => containerLines.includes(l)));
  const images = run('docker', [
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]).split('\n');
  assert(entry.images.every((l) => images.includes(l)));
  for (const id of [
    'sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55',
    'sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497',
  ])
    assert(
      images.some((line) => line.split(' ')[0] === id),
      'C2 image missing',
    );
  const live = {
    container: containerLines.filter(Boolean).map((line) => {
      const [id, name] = line.split(' ');
      return { id, name };
    }),
    network: networkLines.filter(Boolean).map((line) => {
      const [id, name] = line.split(' ');
      return { id, name };
    }),
    volume: [...volumes].filter(Boolean).map((name) => ({ name })),
  };
  const resources = new Map();
  const ports = new Set();
  function collect(evidence) {
    for (const value of resourceDescriptors(evidence)) {
      const owner = value.owner || value.run;
      assert(value.name.includes(owner), 'Resource UUID/name mismatch');
      const type = value.type || 'container';
      assert(value.cleaned === true || value.absent === true, 'Missing resource cleanup record');
      assertResourceAbsent({ ...value, type, owner }, live);
      if (Number.isInteger(value.port)) ports.add(value.port);
      resources.set(value.id || value.name, {
        id: value.id,
        name: value.name,
        type,
        owner,
        absent: true,
      });
      for (const v of value.volumes || [])
        assert(v.absent && !volumes.has(v.name), 'Volume still present');
    }
  }
  for (const file of filesIn(root).filter(
    (f) => f.endsWith('-resources.json') || /^sse-mongo-read-.*\.json$/.test(path.basename(f)),
  ))
    collect(read(file));
  collect(input.build.probe);
  for (const dir of [http.directory, full.directory])
    for (const evidence of resourceEvidence(dir)) collect(evidence);
  const c1 = steps.full.command.c1Directory;
  assert(c1 && path.dirname(c1) === path.resolve('artifacts/round-c1'));
  const c1Owner = read(path.join(c1, 'c2-owner.json'));
  assert.equal(c1Owner.root, root);
  assert.equal(c1Owner.step, steps.full.directory);
  for (const file of fs
    .readdirSync(c1)
    .filter((f) => f.startsWith('resources-') && f.endsWith('.json')))
    collect(read(path.join(c1, file)));
  const native = read(c1 + '/native-regression-resource.json');
  assert(native.closed && native.observation === 'ECONNREFUSED');
  ports.add(native.port);
  const legacyIndex = read(full.directory + '/b03-index-resource.json');
  assert(legacyIndex.cleanupExitCode === 0 && legacyIndex.absent === true);
  ports.add(legacyIndex.port);
  for (const dir of [http.directory, full.directory])
    for (const file of fs.readdirSync(dir).filter((f) => /^sse-mongo-read-.*\.json$/.test(f))) {
      const resource = read(path.join(dir, file)).resource;
      assert(resource.cleaned && Number.isInteger(resource.port));
      ports.add(resource.port);
    }
  for (const dir of [http.directory, full.directory])
    for (const file of fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('identity-migration-') && f.endsWith('.json')))
      for (const host of read(path.join(dir, file)).hosts) ports.add(host.port);
  const portChecks = await Promise.all(
    [...ports].map(
      (port) =>
        new Promise((resolve) => {
          const socket = net.createConnection({ host: '127.0.0.1', port });
          socket.setTimeout(1000);
          socket.once('connect', () => {
            socket.destroy();
            resolve({ port, closed: false });
          });
          socket.once('timeout', () => {
            socket.destroy();
            resolve({ port, closed: false });
          });
          socket.once('error', (e) => resolve({ port, closed: e.code === 'ECONNREFUSED' }));
        }),
    ),
  );
  assert(portChecks.every((p) => p.closed));
  const b01Verified = [
    ['http', http],
    ['all', full],
  ].map(([mode, gate]) =>
    require('../../../scripts/verify-be-evidence').verifyRun(gate.directory, {
      mode,
      manifest: sourceManifest(),
      visibleIds: [...containers],
    }),
  );
  assert(b01Verified.every((r) => r.failures.length === 0));
  const coverage = require('../../../scripts/check-commerce-coverage').checkCoverage(
    full.directory + '/coverage',
  );
  assert.deepStrictEqual(coverage.failures, []);
  const backups = read(full.directory + '/b07-evidence.json').filter(
    (e) => e.scenario === 'backup-restore',
  );
  assert.equal(backups.length, 1);
  const archive = assertArchiveChain(
    fs.readFileSync(full.directory + '/b07-fixture.archive.gz'),
    backups[0],
    path.basename(full.directory),
  );
  const lint = fs.readFileSync(steps.lint.directory + '/quality-output.txt', 'utf8');
  const lintGate = JSON.parse(lint.slice(lint.indexOf('{')));
  assert.deepStrictEqual(lintGate.violations, []);
  const lintAllText = require('node:util').stripVTControlCharacters(
    fs.readFileSync(steps.lintall.directory + '/quality-output.txt', 'utf8'),
  );
  const debt = lintAllText.match(/(\d+) problems \((\d+) errors, (\d+) warnings\)/);
  assert(debt);
  assert.equal(Number(debt[2]), lintGate.debtErrors);
  assert.equal(Number(debt[3]), 0);
  assert.equal(steps.lintall.command.exitCode, 1);
  const ownedVolumes = [
    ...new Set(
      fs
        .readdirSync(c1)
        .filter((f) => f.startsWith('resources-'))
        .flatMap((f) => (read(path.join(c1, f)).volumes || []).map((v) => v.name)),
    ),
  ];
  assert(
    ownedVolumes.every((name) => !volumes.has(name)),
    'C1 owned volume still present',
  );
  const evidenceFiles = [
    ...filesIn(root).filter(
      (f) =>
        !(path.dirname(f) === root && excluded.has(path.basename(f))) &&
        !f.startsWith(path.join(root, 'steps', 'seal') + path.sep) &&
        !f.startsWith(path.join(root, 'steps', 'check') + path.sep) &&
        !['seal-latest.txt', 'check-latest.txt'].includes(path.basename(f)),
    ),
    ...filesIn(http.directory),
    ...filesIn(full.directory),
    ...filesIn(c1),
    ...Object.keys(snapshot.importedHarness),
  ];
  const evidence = Object.fromEntries(
    [...new Set(evidenceFiles)]
      .sort()
      .map((f) => [path.relative(process.cwd(), f).replaceAll('\\', '/'), sha(fs.readFileSync(f))]),
  );
  return {
    round: 'C2',
    status: 'LOCAL_PHASE9_PASS_WITH_ACCEPTED_OPEN_P2',
    head: entry.head,
    image: input.build.image,
    source: current,
    evidence,
    archive,
    resources: [...resources.values()],
    volumesAbsent: ownedVolumes,
    portsClosed: portChecks,
    ownerAcceptance: {
      issue: 'B-A1-AV01',
      severity: 'P2',
      state: 'open',
      textSha256: sha(Buffer.from(raw)),
      source: 'Verbatim owner-provided decision; no assistant signature',
    },
    gates: {
      commands: Object.fromEntries(names.map((n) => [n, steps[n].command.exitCode])),
      strict: 21,
      phase5: 12,
      faults: 4,
      workers: 5,
      code91: 1,
      http: http.jest.numPassedTests,
      full: full.jest.numPassedTests,
      coverageModules: 8,
      lintAllDebt: Number(debt[2]),
    },
    remoteCI: 'pending exact reviewed commit after owner commit',
    productionReady: false,
    phase10Run: false,
    historicalEvidenceUnchanged: true,
    originalContainersPreserved: entry.containers.length,
    candidateImageRetained: true,
  };
}
(async () => {
  assert(['--preflight', '--seal', '--check'].includes(mode));
  const result = await verify();
  const sourceFile = root + '/final-source.json',
    evidenceFile = root + '/final-evidence.json',
    sealFile = root + '/c2-seal.json';
  const summary = Object.fromEntries(
    Object.entries(result).filter(([key]) => !['source', 'evidence'].includes(key)),
  );
  if (mode === '--seal') {
    assert(!fs.existsSync(sealFile), 'Seal overwrite refused');
    fs.writeFileSync(sourceFile, JSON.stringify(result.source, null, 2) + '\n');
    fs.writeFileSync(evidenceFile, JSON.stringify(result.evidence, null, 2) + '\n');
    fs.writeFileSync(
      sealFile,
      JSON.stringify(
        {
          ...summary,
          generatedAt: new Date().toISOString(),
          generatedBy: 'tests/helpers/roundC2/verify.js',
          verifierSha256: sha(fs.readFileSync(__filename)),
          sourceManifestSha256: sha(fs.readFileSync(sourceFile)),
          evidenceManifestSha256: sha(fs.readFileSync(evidenceFile)),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  }
  if (mode === '--check') {
    const seal = read(sealFile);
    assert.equal(seal.verifierSha256, sha(fs.readFileSync(__filename)));
    assert.equal(seal.sourceManifestSha256, sha(fs.readFileSync(sourceFile)));
    assert.equal(seal.evidenceManifestSha256, sha(fs.readFileSync(evidenceFile)));
    compareComplete(read(sourceFile), result.source);
    compareComplete(read(evidenceFile), result.evidence);
    compareComplete(
      summary,
      Object.fromEntries(
        Object.entries(seal).filter(
          ([key]) =>
            ![
              'generatedAt',
              'generatedBy',
              'verifierSha256',
              'sourceManifestSha256',
              'evidenceManifestSha256',
            ].includes(key),
        ),
      ),
    );
  }
  write('verification.json', {
    mode,
    exitCode: 0,
    status: result.status,
    gates: result.gates,
    resources: result.resources.length,
    volumes: result.volumesAbsent.length,
    archive: result.archive,
  });
  console.log(
    JSON.stringify({
      exitCode: 0,
      mode,
      status: result.status,
      resources: result.resources.length,
      gates: result.gates,
    }),
  );
})().catch((error) => {
  write('verification.json', {
    mode,
    exitCode: 1,
    failure: { name: error.name, message: error.message },
  });
  console.log(
    JSON.stringify({ mode, exitCode: 1, failure: { name: error.name, message: error.message } }),
  );
  process.exitCode = 1;
});
