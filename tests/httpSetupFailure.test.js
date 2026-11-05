const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test.each([
  [
    'invalid Redis database',
    { TEST_REDIS_URL: 'redis://127.0.0.1:6379/16' },
    'Test Redis requires',
  ],
  [
    'ambient Mongo target',
    {
      TEST_REDIS_URL: 'redis://127.0.0.1:6379/15',
      TEST_MONGODB_URI: 'mongodb://127.0.0.1:1/totmart_test',
    },
    'Crash drill requires its own disposable Mongo process',
  ],
])('%s fails before provisioning without DB teardown timeouts', (name, overrides, expected) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'totmart-setup-'));
  const output = path.join(directory, 'result.json');
  const env = { ...process.env, CI: 'true', LOG_LEVEL: 'silent', ...overrides };
  if (!overrides.TEST_MONGODB_URI) delete env.TEST_MONGODB_URI;
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        require.resolve('jest/bin/jest'),
        '--runInBand',
        '--runTestsByPath',
        'tests/redisHttp.integration.test.js',
        '--json',
        '--outputFile',
        output,
      ],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 45000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1); // Expected rejection, never a skipped/passing HTTP suite.
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.numFailedTests).toBe(16); // Twelve prior cases plus four B06 product/subscription scenarios.
    expect(report.numPendingTests).toBe(0);
    expect(report.testResults[0].message).toContain(expected);
    expect(report.testResults[0].message).not.toMatch(
      /buffering timed out|Exceeded timeout|Test suite failed to run/,
    );
  } finally {
    if (existsSync(output)) unlinkSync(output);
    rmdirSync(directory);
  }
});
