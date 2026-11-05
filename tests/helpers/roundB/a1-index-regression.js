// Verify the newly authorized exact fixture cleanup and DB helper regression.
// This selected run is not B01 full and does not claim its coverage gate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const directory = fs.mkdtempSync(root + '/index-regression-');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'totmart-a1-index-'));
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
const child = spawn(
  process.execPath,
  [
    '--experimental-vm-modules',
    require.resolve('jest/bin/jest'),
    '--runInBand',
    '--runTestsByPath',
    'tests/identityB03.integration.test.js',
    'tests/dbLifecycle.test.js',
    '--json',
    '--outputFile',
    raw,
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
let outputBytes = 0;
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    outputBytes += data.length;
  });
child.on('close', (code) => {
  const result = {
    jestExitCode: code,
    rawOutputPublished: false,
    outputBytes,
    fullB01: false,
    coverage: 'NOT-RUN',
  };
  if (fs.existsSync(raw)) {
    const data = JSON.parse(fs.readFileSync(raw));
    result.counts = {
      pass: data.numPassedTests,
      fail: data.numFailedTests,
      skip: data.numPendingTests,
    };
    result.suites = data.testResults.map((s) => ({
      file: path.relative(process.cwd(), s.name),
      status: s.status,
      tests: s.assertionResults.map((t) => ({ name: t.fullName, status: t.status })),
    }));
    fs.unlinkSync(raw);
  }
  fs.rmdirSync(temporary);
  fs.writeFileSync(directory + '/report.json', JSON.stringify(result, null, 2));
  fs.writeFileSync(root + '/index-regression-latest.txt', directory);
  console.log(JSON.stringify({ directory, ...result, suites: undefined }));
  process.exitCode = code ?? 1;
});
