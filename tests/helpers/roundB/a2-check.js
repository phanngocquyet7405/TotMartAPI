// Capture raw test output privately; publish only counts, locations and exit codes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a2-0/current.json')).directory;
const full = process.argv.includes('--full');
const directory = fs.mkdtempSync(root + (full ? '/full-' : '/selected-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'totmart-a2-check-'));
const raw = path.join(temporary, 'jest.json');
const env = {
  ...process.env,
  CI: 'true',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  NODE_OPTIONS: '--require ' + JSON.stringify(path.resolve('tests/helpers/noDotenv.js')),
  B01_B03_INDEX_RESOURCE_FILE: path.resolve(directory + '/b03-index-resource.json'),
};
for (const key of Object.keys(env))
  if (
    /^(TEST_|MONGODB_URI$|REDIS_|JWT_|SEPAY_|CLOUDINARY_|BREVO_|FROM_EMAIL$|PORT$|FRONTEND_URL$|CORS_ORIGINS$|TRUST_PROXY$|BCRYPT_COST$|ORDER_EXPIRY_HOURS$)/.test(
      key,
    )
  )
    delete env[key];
const args = full
  ? ['scripts/run-be-tests.js', '--all']
  : [
      '--experimental-vm-modules',
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--runTestsByPath',
      ...process.argv.slice(2),
      '--json',
      '--outputFile',
      raw,
    ];
const child =
  full && process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run test:b01'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    : spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    output += data.toString();
  });
child.on('close', (code) => {
  const result = { exitCode: code, full, outputBytes: Buffer.byteLength(output) };
  if (fs.existsSync(raw)) {
    const data = JSON.parse(fs.readFileSync(raw));
    result.counts = {
      pass: data.numPassedTests,
      fail: data.numFailedTests,
      skip: data.numPendingTests,
    };
    result.suites = data.testResults.map((suite) => ({
      file: path.relative(process.cwd(), suite.name),
      status: suite.status,
      tests: suite.assertionResults.map((test) => ({
        name: test.fullName,
        status: test.status,
        failure: test.failureMessages.length
          ? test.failureMessages.map((m) =>
              m
                .split('\n')
                .filter((l) => /Error:|Expected:|Received:|at .*tests[\\/]/.test(l))
                .map((l) => l.replace(/mongodb[^\s]*/gi, '[redacted]'))
                .slice(0, 6),
            )
          : undefined,
      })),
    }));
    fs.unlinkSync(raw);
  }
  fs.rmdirSync(temporary);
  fs.writeFileSync(directory + '/report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ directory, ...result, suites: undefined }));
  process.exitCode = code ?? 1;
});
