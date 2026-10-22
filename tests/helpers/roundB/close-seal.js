// Generates/checks a Round B seal from complete current source and fresh evidence.
// Acceptance text is user supplied; this verifier never signs for the owner.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const { inventory } = require('./close-backlog');
const { evaluate, compareComplete, compareSealSummary } = require('./close-policy');
const root = path.resolve(
  JSON.parse(fs.readFileSync('artifacts/round-b/close/current.json')).directory,
);
const read = (file) => JSON.parse(fs.readFileSync(file));
const run = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const ignored = new Set([
  'round-b-seal.json',
  'verification.json',
  'final-source-sha256.json',
  'evidence-sha256.json',
]);
function filesIn(directory) {
  const files = [];
  function walk(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) throw Error('Evidence symlink refused');
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) files.push(file);
    }
  }
  walk(directory);
  return files;
}
function loadStep(step) {
  const directory = path.resolve(fs.readFileSync(path.join(root, step + '-latest.txt'), 'utf8'));
  assert(directory.startsWith(root + path.sep + 'steps' + path.sep + step + path.sep));
  const command = read(path.join(directory, 'command.json'));
  assert.equal(command.step, step);
  return { directory, command };
}
function b01(step) {
  const selected = loadStep(step);
  assert.equal(selected.command.b01Directories.length, 1);
  const directory = path.resolve('artifacts/b01', selected.command.b01Directories[0]);
  assert(directory.startsWith(path.resolve('artifacts/b01') + path.sep));
  return {
    directory,
    exit: read(directory + '/exit.json'),
    jest: read(directory + '/jest.json'),
    ...(step === 'full' ? { coverage: read(directory + '/commerce-coverage-gate.json') } : {}),
  };
}
function collectEvidence(http, full) {
  return Object.fromEntries(
    [
      ...filesIn(root).filter(
        (file) => !(path.dirname(file) === root && ignored.has(path.basename(file))),
      ),
      ...filesIn(http.directory),
      ...filesIn(full.directory),
    ]
      .sort()
      .map((file) => [
        path.relative(process.cwd(), file).replaceAll('\\', '/'),
        sha256(fs.readFileSync(file)),
      ]),
  );
}
async function verify() {
  const entry = read(root + '/entry.json');
  assert.equal(run('git', ['rev-parse', 'HEAD']), entry.head);
  for (const [file, hash] of Object.entries(entry.protectedHashes))
    assert.equal(sha256(fs.readFileSync(file)), hash, 'Historical evidence changed: ' + file);
  const baseSource = sourceManifest();
  const current = Object.fromEntries(
    Object.entries({
      ...baseSource,
      ...sourceManifest(process.cwd(), ['docs'], ['AGENTS.md']),
    }).sort(([a], [b]) => a.localeCompare(b)),
  );
  const immutable = (manifest) =>
    Object.fromEntries(
      Object.entries(manifest).filter(
        ([file]) => !/^(tests|docs)\//.test(file) && file !== 'OPERATIONS.md',
      ),
    );
  compareComplete(immutable(entry.source), immutable(baseSource));
  const backlog = read(root + '/unbudgeted-transaction-calls.json');
  compareComplete(backlog, inventory());
  const raw = fs
    .readFileSync(root + '/owner-provided.txt', 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');
  const document = fs.readFileSync('docs/BE-open-issues.md', 'utf8').replace(/\r\n/g, '\n');
  const quoted = document.match(
    /<!-- owner-decision-start -->\n```text\n([\s\S]*?)\n```\n<!-- owner-decision-end -->/,
  )?.[1];
  const steps = Object.fromEntries(
    [
      'build',
      'runtime',
      'strict',
      'phase5',
      'faults',
      'code91',
      'http',
      'full',
      'lint',
      'format',
      'api',
      'verifier-tests',
    ].map((step) => [step, loadStep(step)]),
  );
  const http = b01('http'),
    full = b01('full');
  const input = {
    owner: { raw, quoted },
    commands: Object.fromEntries(
      Object.entries(steps).map(([step, value]) => [step, value.command.exitCode]),
    ),
    build: read(root + '/candidate.json'),
    runtime: read(steps.runtime.directory + '/runtime.json'),
    strict: read(steps.strict.directory + '/phase3-final.json'),
    phase5: read(steps.phase5.directory + '/phase5.json'),
    faults: read(steps.faults.directory + '/faults.json'),
    code91: read(steps.code91.directory + '/code91.json'),
    http,
    full,
  };
  const policy = evaluate(input);
  // Verify current runtime bytes again; the old source-bound coverage policy stays unchanged.
  const expectedRuntime = Object.fromEntries(
    Object.entries(current).filter(
      ([file]) =>
        /^(src|scripts)\//.test(file) || ['package.json', 'package-lock.json'].includes(file),
    ),
  );
  compareComplete(expectedRuntime, input.runtime.runtime.files);
  const coverage = require('../../../scripts/check-commerce-coverage').checkCoverage(
    full.directory + '/coverage',
  );
  assert.deepStrictEqual(coverage.failures, []);
  const containers = run('docker', [
    'ps',
    '-a',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Names}}',
  ]).split('\n');
  const containerIds = new Set(containers.map((line) => line.split(' ')[0]));
  const networks = new Set(
    run('docker', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
  );
  const images = run('docker', [
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]).split('\n');
  assert(entry.containers.every((line) => containers.includes(line)));
  assert(entry.images.every((line) => images.includes(line)));
  const resources = [];
  for (const file of filesIn(root).filter((file) => file.endsWith('-resources.json'))) {
    const data = read(file);
    for (const resource of data.resources) {
      assert.equal(resource.owner, data.run);
      assert(resource.name.startsWith('totmart-b-' + data.run));
      assert(resource.cleaned && resource.absent);
      assert(!(resource.type === 'container' ? containerIds : networks).has(resource.id));
      resources.push({ id: resource.id, type: resource.type, owner: data.run });
    }
  }
  assert(resources.length > 0);
  assert(input.build.probe.cleaned && !containerIds.has(input.build.probe.id));
  resources.push({ id: input.build.probe.id, type: 'container', owner: input.build.run });
  for (const directory of [http.directory, full.directory]) {
    for (const name of ['primitives-resource.json', 'http-resource.json']) {
      const resource = read(path.join(directory, name));
      assert(resource.cleaned && /^[a-f0-9]{64}$/.test(resource.id));
      assert(resource.name.startsWith('totmart-session-' + resource.owner));
      assert(!containerIds.has(resource.id));
      resources.push({ id: resource.id, type: 'container', owner: resource.owner });
    }
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (/^[a-f0-9]{64}$/.test(value.id || '') && value.owner && value.name) {
        assert(
          value.name.startsWith('totmart-session-' + value.owner) ||
            value.name.startsWith('totmart-b07-' + value.owner),
        );
        assert(value.cleaned && !containerIds.has(value.id));
        if (!resources.some((resource) => resource.id === value.id))
          resources.push({ id: value.id, type: 'container', owner: value.owner });
      }
      for (const item of Object.values(value)) visit(item);
    }
    for (const file of fs.readdirSync(directory).filter((file) => file.endsWith('.json')))
      visit(read(path.join(directory, file)));
  }
  const ports = [
    ...new Set(
      [http.directory, full.directory].flatMap((directory) =>
        fs
          .readdirSync(directory)
          .filter((file) => file.startsWith('identity-migration-'))
          .flatMap((file) => read(path.join(directory, file)).hosts.map((host) => host.port)),
      ),
    ),
  ];
  const portChecks = await Promise.all(
    ports.map(
      (port) =>
        new Promise((resolve) => {
          const socket = net.createConnection({ host: '127.0.0.1', port });
          socket.setTimeout(1000);
          socket.on('connect', () => {
            socket.destroy();
            resolve({ port, closed: false });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ port, closed: false });
          });
          socket.on('error', (error) => resolve({ port, closed: error.code === 'ECONNREFUSED' }));
        }),
    ),
  );
  assert(portChecks.length > 0 && portChecks.every((value) => value.closed));
  const evidence = collectEvidence(http, full);
  return {
    ...policy,
    head: entry.head,
    source: current,
    evidence,
    resources,
    ownerAcceptance: {
      source: 'verbatim user-provided text; no assistant signature',
      textSha256: sha256(raw),
      textFile: path
        .relative(process.cwd(), path.join(root, 'owner-provided.txt'))
        .replaceAll('\\', '/'),
      issue: 'B-A1-AV01',
      severity: 'P2',
      state: 'open',
      edgeDeadline: 'unverified; placeholder retained verbatim',
      readinessP99Alerts: 'unverified; placeholder retained verbatim',
      expiresBefore: 'real-user staging or opening sales; review after DR03/DR05 and load phase',
    },
    backlog,
    gates: {
      strict: 21,
      phase5: 12,
      faults: 4,
      code91: 1,
      http: http.jest.numPassedTests,
      full: full.jest.numPassedTests,
      commands: input.commands,
    },
    originalContainersPreserved: entry.containers.length,
    originalImagesPreserved: entry.images.length,
    candidateImageRetained: policy.image,
    historicalEvidenceUnchanged: true,
    identityMongoPortsClosed: portChecks,
  };
}
async function main() {
  const mode = process.argv[2];
  assert(['--seal', '--check', '--preflight'].includes(mode));
  const result = await verify();
  const sourceFile = root + '/final-source-sha256.json',
    evidenceFile = root + '/evidence-sha256.json',
    sealFile = root + '/round-b-seal.json';
  if (mode === '--seal') {
    assert(!fs.existsSync(sealFile), 'Refusing to overwrite seal');
    fs.writeFileSync(sourceFile, JSON.stringify(result.source, null, 2) + '\n');
    fs.writeFileSync(evidenceFile, JSON.stringify(result.evidence, null, 2) + '\n');
    const summary = Object.fromEntries(
      Object.entries(result).filter(([key]) => !['source', 'evidence'].includes(key)),
    );
    const seal = {
      ...summary,
      generatedAt: new Date().toISOString(),
      generatedBy: 'tests/helpers/roundB/close-seal.js',
      verifierSha256: sha256(fs.readFileSync(__filename)),
      sourceManifestSha256: sha256(fs.readFileSync(sourceFile)),
      evidenceManifestSha256: sha256(fs.readFileSync(evidenceFile)),
    };
    fs.writeFileSync(sealFile, JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
  }
  if (mode === '--check') {
    const seal = read(sealFile);
    assert.equal(seal.verifierSha256, sha256(fs.readFileSync(__filename)));
    assert.equal(seal.sourceManifestSha256, sha256(fs.readFileSync(sourceFile)));
    assert.equal(seal.evidenceManifestSha256, sha256(fs.readFileSync(evidenceFile)));
    compareComplete(read(sourceFile), result.source);
    compareComplete(read(evidenceFile), result.evidence);
    assert.equal(seal.ownerAcceptance.textSha256, result.ownerAcceptance.textSha256);
    assert.equal(seal.status, result.status);
    compareSealSummary(seal, result);
  }
  fs.writeFileSync(
    root + '/verification.json',
    JSON.stringify(
      {
        mode,
        exitCode: 0,
        status: result.status,
        gates: result.gates,
        resourceCount: result.resources.length,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      mode,
      exitCode: 0,
      status: result.status,
      gates: result.gates,
      resourceCount: result.resources.length,
    }),
  );
}
if (require.main === module) {
  main().catch((error) => {
    fs.writeFileSync(
      root + '/verification.json',
      JSON.stringify(
        {
          mode: process.argv[2],
          exitCode: 1,
          failureType: error.name,
          reason: error.message.replace(
            /(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s]+/gi,
            '[REDACTED_URI]',
          ),
        },
        null,
        2,
      ),
    );
    console.error('Round B verifier refused seal/check; inspect safe verification.json');
    process.exitCode = 1;
  });
}
