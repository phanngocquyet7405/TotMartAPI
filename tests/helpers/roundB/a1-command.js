// Capture only sanitized verification summaries. Never publish inherited env,
// assertion values, console bodies, fixture credentials or connection strings.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const name = process.argv[2];
const allowed = new Set(['lint', 'format:check', 'validate:api', 'test:b01:http', 'test:b01']);
if (!allowed.has(name)) throw Error('Unsupported verification command');
const directory = root + '/command-' + name.replaceAll(':', '-') + '-' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
const startedAt = Date.now();
const prior = new Set(fs.readdirSync('artifacts/b01'));
const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm run ' + name], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let byteCount = 0;
let qualityOutput = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    byteCount += data.length;
    if (!name.startsWith('test:')) qualityOutput += data.toString();
    // Test paths and aggregate Jest counts only; do not forward failing assertions.
    for (const line of data.toString().split(/\r?\n/))
      if (
        /^(?:PASS|FAIL) tests\/[\w./-]+\.test\.js(?:\s|$)/.test(line) ||
        /^(?:Test Suites|Tests|Time):\s+[\d\w\s,.()]+$/.test(line)
      )
        console.log(line);
  });
child.on('error', (error) => {
  fs.writeFileSync(
    directory + '/spawn-error.json',
    JSON.stringify({ type: error.name, code: error.code }),
  );
});
child.on('close', (code, signal) => {
  const added = fs.readdirSync('artifacts/b01').filter((file) => !prior.has(file));
  const artifacts = added.flatMap((file) => {
    const target = path.join('artifacts/b01', file);
    if (!fs.statSync(target).isDirectory()) return [];
    const value = { directory: target.replaceAll('\\', '/') };
    for (const [key, filename] of [
      ['exit', 'exit.json'],
      ['jest', 'jest.json'],
      ['coverage', 'commerce-coverage-gate.json'],
    ]) {
      const f = path.join(target, filename);
      if (fs.existsSync(f)) value[key] = JSON.parse(fs.readFileSync(f));
    }
    return [value];
  });
  const result = {
    command: 'npm run ' + name,
    startedAt,
    endedAt: Date.now(),
    exitCode: code,
    signal,
    capturedOutputBytes: byteCount,
    rawOutputPublished: false,
    qualityOutput: name.startsWith('test:') ? undefined : qualityOutput,
    artifacts,
  };
  fs.writeFileSync(directory + '/report.json', JSON.stringify(result, null, 2));
  fs.writeFileSync(root + '/command-' + name.replaceAll(':', '-') + '-latest.txt', directory);
  console.log(
    JSON.stringify({
      directory,
      command: result.command,
      exitCode: code,
      artifacts: artifacts.map((a) => ({
        directory: a.directory,
        exit: a.exit,
        pass: a.jest?.numPassedTests,
        fail: a.jest?.numFailedTests,
        skip: a.jest?.numPendingTests,
        coverageFailures: a.coverage?.failures,
      })),
    }),
  );
  process.exitCode = code ?? 1;
});
