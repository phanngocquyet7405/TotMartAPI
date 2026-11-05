const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const mode = process.argv[2];
if (mode === 'entry') {
  const run = randomUUID(),
    directory = 'artifacts/round-c1/' + run;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync('artifacts/round-c1/current.json', JSON.stringify({ directory }));
  process.env.C1_DIRECTORY = path.resolve(directory);
  const { write, docker } = require('./context');
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const disk = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" -ErrorAction Stop | Select-Object Size,FreeSpace | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
  if (disk.FreeSpace < 10 * 1024 ** 3)
    throw new Error('C1 requires 10 GiB free before datasets/archive');
  const { sourceManifest } = require('../../../scripts/evidence-manifest');
  write('entry.json', {
    run,
    cwd: process.cwd(),
    head: git(['rev-parse', 'HEAD']),
    tags: git(['tag', '--sort=-creatordate']),
    status: git(['status', '--short']),
    disk,
    node: process.version,
    dockerVersion: docker(['version', '--format', '{{.Server.Version}}']),
    containers: docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).split('\n'),
    images: docker(['images', '--no-trunc', '--format', '{{.Repository}}:{{.Tag}} {{.ID}}']).split(
      '\n',
    ),
    source: sourceManifest(),
    phase9: false,
    seal: false,
  });
  console.log(JSON.stringify({ directory, exitCode: 0 }));
} else {
  process.env.C1_DIRECTORY = path.resolve(
    JSON.parse(fs.readFileSync('artifacts/round-c1/current.json')).directory,
  );
  const { root, write } = require('./context');
  const env = {
    ...process.env,
    C1_DIRECTORY: root,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CI: 'true',
  };
  for (const key of Object.keys(env))
    if (
      /^(TEST_|MONGODB_|MIGRATION_|REDIS_|JWT_|SEPAY_|CLOUDINARY_|BREVO_|FROM_EMAIL$|PORT$|FRONTEND_URL$|CORS_ORIGINS$|TRUST_PROXY$|BCRYPT_COST$|ORDER_EXPIRY_HOURS$)/.test(
        key,
      )
    )
      delete env[key];
  const attempt = mode + '-' + randomUUID();
  env.C1_ATTEMPT = attempt;
  const isMigration =
    mode === 'migration' ||
    mode === 'migration-red' ||
    mode === 'migration-owner-red' ||
    mode === 'regression';
  const raw = path.join(root, attempt + '-private.json');
  const args = [
    '--require',
    path.resolve('tests/helpers/noDotenv.js'),
    ...(isMigration
      ? [
          '--experimental-vm-modules',
          require.resolve('jest/bin/jest'),
          '--runInBand',
          '--runTestsByPath',
          mode === 'regression'
            ? 'tests/attemptRecovery.integration.test.js'
            : 'tests/commerceMigrationC1.integration.test.js',
          ...(mode === 'migration-red'
            ? ['--testNamePattern', 'manifest v2 preserves']
            : mode === 'migration-owner-red'
              ? ['--testNamePattern', 'refuses legacy']
              : []),
          '--json',
          '--outputFile',
          raw,
        ]
      : [path.resolve('tests/helpers/roundC1/' + mode + '.js')]),
  ];
  const result = spawnSync(process.execPath, args, {
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 1200000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const report = {
    mode,
    exitCode: result.status,
    signal: result.signal,
    outputBytes: Buffer.byteLength((result.stdout || '') + (result.stderr || '')),
  };
  if (fs.existsSync(raw)) {
    const data = JSON.parse(fs.readFileSync(raw));
    report.counts = {
      pass: data.numPassedTests,
      fail: data.numFailedTests,
      skip: data.numPendingTests,
    };
    report.tests = data.testResults.flatMap((s) =>
      s.assertionResults.map((t) => ({
        name: t.fullName,
        status: t.status,
        failure: t.failureMessages.map((m) =>
          m
            .split('\n')
            .filter((l) => /Error:|Expected:|Received:|at .*tests[\\/]/.test(l))
            .slice(0, 7),
        ),
      })),
    );
    fs.unlinkSync(raw);
  }
  write(attempt + '.json', report);
  write(mode + '-latest.json', { file: attempt + '.json' });
  const snapshot = path.join(root, 'attempts', attempt);
  fs.mkdirSync(snapshot, { recursive: true });
  for (const file of fs.readdirSync(root))
    if (fs.statSync(path.join(root, file)).isFile())
      fs.copyFileSync(path.join(root, file), path.join(snapshot, file));
  console.log(JSON.stringify({ file: attempt + '.json', ...report, tests: undefined }));
  process.exitCode = result.status ?? 1;
}
