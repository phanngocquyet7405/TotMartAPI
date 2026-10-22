// Each command gets immutable per-attempt paths and sanitized output. No ambient targets.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/close/current.json')).directory;
const step = process.argv[2];
const steps = {
  build: ['node', ['tests/helpers/roundB/build-candidate.js', '--final']],
  runtime: ['node', ['tests/helpers/roundB/close-runtime.js']],
  strict: ['node', ['tests/helpers/roundB/strict-image.js', '--final']],
  phase5: ['node', ['tests/helpers/roundB/phase5.js']],
  faults: ['node', ['tests/helpers/roundB/close-faults.js']],
  code91: ['node', ['tests/helpers/roundB/close-code91.js']],
  http: ['npm', ['run', 'test:b01:http']],
  full: ['npm', ['run', 'test:b01']],
  lint: ['npm', ['run', 'lint']],
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
    ],
  ],
};
if (!Object.hasOwn(steps, step)) throw Error('Unknown close step');
const directory = path.join(root, 'steps', step, randomUUID());
fs.mkdirSync(directory, { recursive: true });
const entry = JSON.parse(fs.readFileSync(root + '/entry.json'));
fs.writeFileSync(directory + '/entry.json', JSON.stringify({ ...entry, directory, root }));
const env = {
  ...process.env,
  ROUND_B_CLOSE_DIR: path.resolve(directory),
  NODE_OPTIONS: '--require ' + JSON.stringify(path.resolve('tests/helpers/noDotenv.js')),
};
if (fs.existsSync(root + '/candidate.json'))
  env.ROUND_B_CLOSE_CANDIDATE_FILE = path.resolve(root + '/candidate.json');
for (const key of Object.keys(env))
  if (
    /^(TEST_|MONGODB_URI$|REDIS_|JWT_|SEPAY_|CLOUDINARY_|BREVO_|FROM_EMAIL$|PORT$|FRONTEND_URL$|CORS_ORIGINS$|TRUST_PROXY$|BCRYPT_COST$|ORDER_EXPIRY_HOURS$)/.test(
      key,
    )
  )
    delete env[key];
const [program, args] = steps[step];
const b01Before = fs.readdirSync('artifacts/b01');
const child =
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
let bytes = 0;
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    bytes += data.length;
  });
child.on('close', (code) => {
  if (step === 'build' && code === 0)
    fs.copyFileSync(directory + '/candidate.json', root + '/candidate.json');
  const report = {
    step,
    command: [program, ...args],
    directory,
    exitCode: code,
    outputBytes: bytes,
    b01Directories: fs.readdirSync('artifacts/b01').filter((name) => !b01Before.includes(name)),
  };
  fs.writeFileSync(directory + '/command.json', JSON.stringify(report, null, 2));
  fs.writeFileSync(root + '/' + step + '-latest.txt', directory);
  console.log(JSON.stringify(report));
  process.exitCode = code ?? 1;
});
