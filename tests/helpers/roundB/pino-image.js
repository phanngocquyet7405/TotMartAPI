const fs = require('node:fs');
const { Lease, candidate } = require('./image-fixture');
const lease = new Lease('pino-image-' + (process.argv[2] || 'red'));
const report = { run: lease.run, image: candidate.image.id, cases: [] };
(async () => {
  try {
    lease.network();
    for (const mode of ['production', 'staging']) {
      const id = lease.create(
        'log-' + mode,
        candidate.image.id,
        ['--tmpfs', '/fixture:mode=1777'],
        ['node', '-e', 'setInterval(()=>{},1000)'],
        lease.config(mode, {
          NODE_PATH: '/app/node_modules',
          REDIS_URL: 'rediss://redis.totmart.test:6379/0',
        }),
      );
      lease.start(id);
      lease.copyFile('tests/helpers/roundB/pino-image-client.js', id, '/fixture/pino-client.js');
      lease.copyFile(
        'tests/helpers/roundA/disclosure-guard.js',
        id,
        '/fixture/disclosure-guard.js',
      );
      const output = lease.exec(id, ['node', '/fixture/pino-client.js'], 20000);
      const line = output.split('\n').findLast((value) => value.startsWith('PINO_IMAGE_RESULT='));
      if (!line) throw Error('Pino image fixture did not publish safe result');
      report.cases.push(JSON.parse(line.slice('PINO_IMAGE_RESULT='.length)));
    }
    report.exitCode = report.cases.every((item) => item.passed) ? 0 : 1;
  } catch {
    report.exitCode = 1;
    report.failure = 'Pino image harness failure';
  } finally {
    report.cleanupExitCode = await lease.cleanup();
    fs.writeFileSync(
      `artifacts/round-b/${lease.phase}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
    process.exitCode = report.exitCode || report.cleanupExitCode;
  }
})();
