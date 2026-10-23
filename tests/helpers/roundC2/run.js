const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { manifest, executable, sha, harnessInputs, importedEvidence } = require('./manifest');
const stepName = process.argv[2];
const command = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
if (stepName === 'entry') {
  const directory = 'artifacts/round-c2/' + randomUUID();
  fs.mkdirSync(directory, { recursive: true });
  const protectedFiles = [
    'artifacts/round-a/round-a-seal.json',
    'artifacts/round-b/close/04f4cb65-09a3-40d8-9b35-3d5861f690ca/round-b-seal.json',
    'artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/backup.json',
    'artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/c1-fixture.archive.gz',
  ];
  const disk = JSON.parse(
    command('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" -ErrorAction Stop | Select-Object Size,FreeSpace | ConvertTo-Json -Compress',
    ]),
  );
  if (disk.FreeSpace < 10 * 1024 ** 3) throw Error('C2 disk prerequisite failed');
  const issue = fs.readFileSync('docs/BE-open-issues.md', 'utf8').replace(/\r\n/g, '\n');
  const raw = issue.match(
    /<!-- owner-decision-start -->\n```text\n([\s\S]*?)\n```\n<!-- owner-decision-end -->/,
  )[1];
  const entry = {
    round: 'C2',
    directory,
    at: new Date().toISOString(),
    cwd: process.cwd(),
    head: command('git', ['rev-parse', 'HEAD']),
    tags: command('git', ['tag', '--sort=-creatordate']),
    status: command('git', ['status', '--short']),
    node: process.version,
    engine: command('docker', ['version', '--format', '{{.Server.Version}}']),
    disk,
    containers: command('docker', [
      'ps',
      '-a',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Names}}',
    ]).split('\n'),
    images: command('docker', [
      'image',
      'ls',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Repository}}:{{.Tag}}',
    ]).split('\n'),
    protectedHashes: Object.fromEntries(protectedFiles.map((f) => [f, sha(fs.readFileSync(f))])),
    source: manifest(),
    gates: {
      c1CheckpointCommitted: true,
      ownerP2AcceptanceVerbatim: true,
      noOtherOpenP0P1InRegistry: true,
    },
    phase10: false,
  };
  fs.writeFileSync(directory + '/entry.json', JSON.stringify(entry, null, 2));
  fs.writeFileSync(directory + '/owner-provided.txt', raw + '\n');
  fs.writeFileSync('artifacts/round-c2/current.json', JSON.stringify({ directory }));
  console.log(JSON.stringify({ directory, head: entry.head, containers: entry.containers.length }));
} else {
  const { root, read, write } = require('./context');
  if (stepName === 'snapshot') {
    const complete = manifest();
    const snapshotDelta = fs.existsSync(root + '/snapshot.json')
      ? require('../../../scripts/evidence-manifest').compareManifest(
          read(root + '/snapshot.json').complete,
          complete,
        )
      : null;
    if (fs.existsSync(root + '/snapshot.json')) {
      const previous = path.join(root, 'previous-snapshots', randomUUID());
      fs.mkdirSync(previous, { recursive: true });
      for (const name of ['snapshot.json', 'contract-manifest.json'])
        if (fs.existsSync(path.join(root, name)))
          fs.copyFileSync(path.join(root, name), path.join(previous, name));
    }
    write('snapshot.json', {
      head: command('git', ['rev-parse', 'HEAD']),
      complete,
      importedHarness: harnessInputs(),
      previousSnapshotDelta: snapshotDelta,
      executable: executable(complete),
      untracked: command('git', ['ls-files', '--others', '--exclude-standard'])
        .split('\n')
        .filter(Boolean),
    });
    const bindings = {};
    for (const gate of ['build', 'runtime', 'strict', 'phase5', 'faults', 'code91', 'workers']) {
      const prior = require('./context').step(gate);
      const previous = prior.command.executableManifest,
        current = executable(complete);
      const binding = {
        gate,
        previousCommandSha256: sha(fs.readFileSync(path.join(prior.directory, 'command.json'))),
        previousManifestSha256: sha(Buffer.from(JSON.stringify(previous))),
        currentManifestSha256: sha(Buffer.from(JSON.stringify(current))),
        delta: [...new Set([...Object.keys(previous), ...Object.keys(current)])]
          .sort()
          .filter((file) => previous[file] !== current[file])
          .map((file) => ({ file, before: previous[file] ?? null, after: current[file] ?? null })),
      };
      require('./policy').assertCompatibleGate(
        gate,
        previous,
        current,
        prior.command.command,
        binding,
      );
      if (['phase5', 'faults', 'code91', 'workers'].includes(gate)) {
        binding.importedHarnessEvidence = importedEvidence(prior.directory);
        require('./policy').assertImportedHarness(harnessInputs(), binding.importedHarnessEvidence);
      }
      bindings[gate] = binding;
    }
    write('snapshot-linkage.json', {
      snapshotSha256: sha(fs.readFileSync(root + '/snapshot.json')),
      reason:
        'Exact support-tool path/hash deltas only; direct gate commands, src/scripts, dependency/config policy, roundB/C1/shared fixture harness and contracts unchanged. Jest roots and C2 reporting/discovery/export/verifier support do not execute in these direct gates. HTTP/full/quality run fresh.',
      bindings,
    });
    write('contract-manifest.json', {
      version: 'C2-20261022.1',
      head: command('git', ['rev-parse', 'HEAD']),
      files: Object.fromEntries(
        Object.entries(complete).filter(
          ([f]) =>
            f.startsWith('src/') ||
            /^docs\/(FE-BE-contract-handoff|checkout-attempt-contract|UNIFIED-COMMERCE-CONTRACT|MANAGER-API-CONTRACT|MERCHANT-OPERATING-MODEL)\.md$/.test(
              f,
            ) ||
            /^docs\/.*(?:openapi|example)/i.test(f),
        ),
      ),
    });
    console.log('C2 snapshot captured');
    process.exit(0);
  }
  const steps = {
    ci: ['npm', ['ci']],
    build: ['node', ['tests/helpers/roundB/build-candidate.js', '--final']],
    runtime: ['node', ['tests/helpers/roundB/close-runtime.js']],
    strict: ['node', ['tests/helpers/roundB/strict-image.js', '--final']],
    phase5: ['node', ['tests/helpers/roundB/phase5.js']],
    faults: ['node', ['tests/helpers/roundB/close-faults.js']],
    'mongo-sse': ['node', ['tests/helpers/roundC2/mongo-sse.js']],
    'sse-tests': [
      'node',
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--runInBand',
        '--runTestsByPath',
        'tests/sseMongoDeadline.integration.test.js',
        'tests/sseHarnessDeadline.test.js',
      ],
    ],
    workers: [
      'node',
      [
        'tests/helpers/roundB/a1-workers.js',
        '--only',
        'expiry,payment,delivery,notification,security',
      ],
    ],
    code91: ['node', ['tests/helpers/roundB/close-code91.js']],
    http: ['npm', ['run', 'test:b01:http']],
    full: ['npm', ['run', 'test:b01']],
    lint: ['npm', ['run', 'lint']],
    lintall: ['npm', ['run', 'lint:all']],
    format: ['npm', ['run', 'format:check']],
    api: ['npm', ['run', 'validate:api']],
    'verifier-tests': [
      'node',
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--runInBand',
        '--runTestsByPath',
        'tests/roundBCloseVerification.test.js',
        'tests/roundC2Verification.test.js',
        'tests/jestDiscovery.test.js',
        'tests/evidenceVerification.test.js',
      ],
    ],
    preflight: ['node', ['tests/helpers/roundC2/verify.js', '--preflight']],
    seal: ['node', ['tests/helpers/roundC2/verify.js', '--seal']],
    check: ['node', ['tests/helpers/roundC2/verify.js', '--check']],
    export: ['node', ['tests/helpers/roundC2/export.js']],
  };
  if (!steps[stepName]) throw Error('Unknown C2 step');
  const directory = path.join(root, 'steps', stepName, randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    directory + '/entry.json',
    JSON.stringify({ ...read(root + '/entry.json'), directory, root }),
  );
  const env = {
    ...process.env,
    C2_DIRECTORY: root,
    ROUND_C2_DIR: directory,
    NODE_OPTIONS: '--require ' + JSON.stringify(path.resolve('tests/helpers/noDotenv.js')),
  };
  for (const key of Object.keys(env))
    if (
      /^(C1_|ROUND_B_CLOSE_DIR$|TEST_|MONGODB_|MIGRATION_|B03_MONGODB_|ACCEPTANCE_MONGODB_|REDIS_|JWT_|SEPAY_|CLOUDINARY_|BREVO_|FROM_EMAIL$|PORT$|FRONTEND_URL$|CORS_ORIGINS$|TRUST_PROXY$|BCRYPT_COST$|ORDER_EXPIRY_HOURS$)/.test(
        key,
      )
    )
      delete env[key];
  if (fs.existsSync(root + '/candidate.json'))
    env.ROUND_B_CLOSE_CANDIDATE_FILE = root + '/candidate.json';
  let c1Directory;
  if (stepName === 'full') {
    c1Directory = path.resolve('artifacts/round-c1', randomUUID());
    fs.mkdirSync(c1Directory);
    env.C1_DIRECTORY = c1Directory;
    env.C1_ATTEMPT = 'c2-full-' + path.basename(directory);
    fs.writeFileSync(c1Directory + '/c2-owner.json', JSON.stringify({ root, step: directory }));
  }
  const before = fs.existsSync('artifacts/b01') ? fs.readdirSync('artifacts/b01') : [];
  let discovery;
  if (['http', 'full'].includes(stepName)) {
    const { listTests, assertCanonicalDiscovery } = require('./jest-discovery');
    const mode = stepName === 'full' ? 'all' : 'http';
    try {
      discovery = { mode, ...assertCanonicalDiscovery(listTests(process.cwd(), mode), { mode }) };
      fs.writeFileSync(directory + '/discovery.json', JSON.stringify(discovery, null, 2));
    } catch (error) {
      fs.writeFileSync(
        directory + '/discovery.json',
        JSON.stringify({ mode, failure: error.message }),
      );
      fs.writeFileSync(
        directory + '/command.json',
        JSON.stringify({
          step: stepName,
          exitCode: 1,
          phase: 'discovery',
          sourceManifest: manifest(),
          executableManifest: executable(manifest()),
        }),
      );
      fs.writeFileSync(root + '/' + stepName + '-latest.txt', directory);
      console.log(JSON.stringify({ step: stepName, exitCode: 1, phase: 'discovery' }));
      process.exit(1);
    }
  }
  const [program, args] = steps[stepName],
    start = Date.now();
  const beforeManifest = executable(manifest());
  if (stepName === 'sse-tests') env.B07_RESOURCE_FILE = path.join(directory, 'sse-resources.json');
  if (['verifier-tests', 'sse-tests'].includes(stepName))
    args.push('--json', '--outputFile', path.join(directory, 'unit-jest.json'));
  let child;
  try {
    child =
      program === 'npm' && process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], {
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn(program === 'node' ? process.execPath : program, args, {
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
  } catch (error) {
    fs.writeFileSync(
      directory + '/command.json',
      JSON.stringify({
        step: stepName,
        command: [program, ...args],
        exitCode: 1,
        phase: 'spawn',
        errorCode: error.code,
        beforeManifest,
        executableManifest: executable(manifest()),
        sourceManifest: manifest(),
      }),
    );
    fs.writeFileSync(root + '/' + stepName + '-latest.txt', directory);
    console.log(
      JSON.stringify({ step: stepName, exitCode: 1, phase: 'spawn', errorCode: error.code }),
    );
    process.exit(1);
  }
  let bytes = 0,
    output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      bytes += data.length;
      if (['lint', 'lintall', 'format', 'api'].includes(stepName)) output += data.toString();
    });
  child.on('error', (error) => {
    write('spawn-error.json', { step: stepName, code: error.code });
  });
  child.on('close', (code, signal) => {
    const b01Directories = (
      fs.existsSync('artifacts/b01') ? fs.readdirSync('artifacts/b01') : []
    ).filter((n) => !before.includes(n));
    let discoveryFailure;
    if (discovery) {
      try {
        if (b01Directories.length !== 1) throw new Error('Ambiguous B01 run');
        const result = JSON.parse(
          fs.readFileSync(path.join('artifacts/b01', b01Directories[0], 'jest.json')),
        );
        const actual = require('./jest-discovery').assertCanonicalDiscovery(
          result.suites.map((s) => s.file),
          { mode: discovery.mode },
        );
        require('node:assert/strict').deepStrictEqual(actual.suiteFiles, discovery.suiteFiles);
      } catch (error) {
        discoveryFailure = error.message;
      }
      fs.writeFileSync(
        directory + '/discovery.json',
        JSON.stringify(
          { ...discovery, runnerSuitesMatched: !discoveryFailure, failure: discoveryFailure },
          null,
          2,
        ),
      );
    }
    if (stepName === 'build' && code === 0)
      fs.copyFileSync(directory + '/candidate.json', root + '/candidate.json');
    const report = {
      step: stepName,
      command: [program, ...args],
      directory,
      exitCode: code === 0 && discoveryFailure ? 1 : code,
      childExitCode: code,
      discoveryFailure,
      signal,
      elapsedMs: Date.now() - start,
      outputBytes: bytes,
      ...(['verifier-tests', 'sse-tests'].includes(stepName) &&
      fs.existsSync(directory + '/unit-jest.json')
        ? {
            unit: ((result) => ({
              passed: result.numPassedTests,
              failed: result.numFailedTests,
              skipped: result.numPendingTests,
              suites: result.numTotalTestSuites,
            }))(JSON.parse(fs.readFileSync(directory + '/unit-jest.json'))),
          }
        : {}),
      c1Directory,
      b01Directories,
      sourceManifest: manifest(),
      beforeManifest,
      executableManifest: executable(manifest()),
    };
    if (output) fs.writeFileSync(directory + '/quality-output.txt', output);
    fs.writeFileSync(directory + '/command.json', JSON.stringify(report, null, 2));
    fs.writeFileSync(root + '/' + stepName + '-latest.txt', directory);
    console.log(
      JSON.stringify({
        ...report,
        sourceManifest: undefined,
        executableManifest: undefined,
        beforeManifest: undefined,
      }),
    );
    process.exitCode = report.exitCode ?? 1;
  });
}
