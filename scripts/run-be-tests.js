// CI and local entrypoint: never reads .env or reuses ambient DB/Redis targets.
const { spawn } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmdirSync,
} = require('node:fs');
const { sourceManifest } = require('./evidence-manifest');
const os = require('node:os');
const path = require('node:path');
const { disposableRedis } = require('../tests/helpers/disposableRedis');

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('B01 requires Node 24');
  const args = process.argv.slice(2);
  const allowed = new Set(['--http', '--all', '--unit', '--ops']);
  if (args.length !== 1 || !allowed.has(args[0]))
    throw new Error('Use --http, --all, --unit or --ops');
  const mode = args[0].slice(2);
  const base = path.resolve('artifacts/b01');
  mkdirSync(base, { recursive: true });
  const output = mkdtempSync(path.join(base, mode + '-'));
  const files = sourceManifest();
  writeFileSync(path.join(output, 'source-sha256.json'), JSON.stringify(files, null, 2) + '\n');
  const rawDir = mkdtempSync(path.join(os.tmpdir(), 'totmart-b01-'));
  const rawFile = path.join(rawDir, 'jest.json');
  let redis,
    child,
    exitCode = 1,
    jestExitCode = null,
    cleanupExitCode = 0,
    coverageExitCode = null;
  const env = {
    ...process.env,
    CI: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    B01_HTTP_RESOURCE_FILE: path.join(output, 'http-resource.json'),
    B05_SERVER_RESOURCE_FILE: path.join(output, 'server-resource.json'),
    B07_RESOURCE_FILE: path.join(output, 'b07-resources.json'),
    NODE_OPTIONS: '--require ' + JSON.stringify(path.resolve('tests/helpers/noDotenv.js')),
  };
  for (const key of Object.keys(env)) {
    if (
      /^(TEST_|MONGODB_URI$|REDIS_|JWT_|SEPAY_|CLOUDINARY_|BREVO_|FROM_EMAIL$|PORT$|FRONTEND_URL$|CORS_ORIGINS$|TRUST_PROXY$|BCRYPT_COST$|ORDER_EXPIRY_HOURS$)/.test(
        key,
      )
    )
      delete env[key];
  }
  // env.setup supplies fixture-only credentials; HTTP children inherit them.
  const signal = () => {
    if (child) child.kill('SIGTERM');
  };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    if (mode !== 'unit') {
      redis = await disposableRedis({
        purpose: 'primitives',
        onEvidence: (evidence) =>
          writeFileSync(
            path.join(output, 'primitives-resource.json'),
            JSON.stringify(evidence) + '\n',
          ),
      });
      env.TEST_REDIS_URL = redis.url;
    }
    const selected =
      mode === 'http'
        ? ['--runTestsByPath', 'tests/redisHttp.integration.test.js']
        : mode === 'ops'
          ? [
              '--runTestsByPath',
              'tests/operationsB07.integration.test.js',
              'tests/commerceInvariants.integration.test.js',
            ]
          : mode === 'unit'
            ? [
                '--runTestsByPath',
                'tests/localRedisUrl.test.js',
                'tests/disposableRedis.test.js',
                'tests/dbLifecycle.test.js',
                'tests/httpSetupFailure.test.js',
              ]
            : [];
    const jestArgs = [
      '--experimental-vm-modules',
      require.resolve('jest/bin/jest'),
      '--runInBand',
      ...selected,
      '--coverage',
      '--coverageDirectory',
      path.join(output, 'coverage'),
      '--coverageReporters=json-summary',
      '--coverageReporters=lcov',
      '--coverageReporters=text-summary',
      '--collectCoverageFrom=src/**/*.js',
      '--json',
      '--outputFile',
      rawFile,
    ];
    exitCode = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, jestArgs, { env, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, receivedSignal) =>
        resolve(code ?? (receivedSignal === 'SIGINT' ? 130 : 143)),
      );
    });
    jestExitCode = exitCode;
  } finally {
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    try {
      redis?.cleanup();
    } catch (error) {
      cleanupExitCode = 1;
      console.error('Owned Redis cleanup failed:', error.message.split('\n')[0]);
      if (exitCode === 0) exitCode = 1;
    }
    process.exitCode = exitCode;
    // Publish counts/statuses only: no console output, assertion values, tokens,
    // failure stack traces or machine-specific absolute paths in artifacts.
    const resultFile = path.join(output, 'jest.json');
    if (existsSync(rawFile)) {
      const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
      const counts = Object.fromEntries(
        Object.entries(raw).filter(([key, value]) => /^num/.test(key) && typeof value === 'number'),
      );
      const suites = raw.testResults.map((suite) => ({
        file: path.relative(process.cwd(), suite.name).replaceAll('\\', '/'),
        status: suite.status,
        tests: suite.assertionResults.map((test) => ({
          name: test.fullName,
          status: test.status,
          duration: test.duration,
        })),
      }));
      writeFileSync(
        resultFile,
        JSON.stringify({ ...counts, success: raw.success, suites }, null, 2) + '\n',
      );
      unlinkSync(rawFile);
    }
    rmdirSync(rawDir);
    const summaryFile = path.join(output, 'coverage/coverage-summary.json');
    if (existsSync(summaryFile)) {
      const raw = JSON.parse(readFileSync(summaryFile, 'utf8'));
      writeFileSync(
        summaryFile,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(raw).map(([key, value]) => [
              key === 'total' ? key : path.relative(process.cwd(), key).replaceAll('\\', '/'),
              value,
            ]),
          ),
          null,
          2,
        ) + '\n',
      );
    }
    if (mode === 'all') {
      let commerceCoverage;
      try {
        commerceCoverage = require('./check-commerce-coverage').checkCoverage(
          path.join(output, 'coverage'),
        );
      } catch {
        commerceCoverage = {
          failures: [{ reason: 'missing or invalid commerce coverage evidence' }],
        };
      }
      writeFileSync(
        path.join(output, 'commerce-coverage-gate.json'),
        JSON.stringify(commerceCoverage, null, 2) + '\n',
      );
      coverageExitCode = commerceCoverage.failures.length ? 1 : 0;
      if (coverageExitCode) exitCode = 1;
      process.exitCode = exitCode;
    }
    writeFileSync(
      path.join(output, 'exit.json'),
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        mode,
        jestExitCode,
        cleanupExitCode,
        coverageExitCode,
        runnerExitCode: exitCode,
      }) + '\n',
    );
  }
}
main().catch((error) => {
  // Do not print Docker command/error objects or inherited environment.
  console.error('B01 runner failed:', error.message.split('\n')[0]);
  process.exitCode = process.exitCode || 1;
});
