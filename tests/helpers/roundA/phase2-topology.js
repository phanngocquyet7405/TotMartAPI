const fs = require('node:fs');
const { Lease, candidate } = require('./image-fixture');
const lease = new Lease('phase2');
const report = { run: lease.run, phase: 2, cases: [], candidateImage: candidate.image.id };
async function main() {
  try {
    lease.network();
    const mongo = await lease.mongo();
    const redis = lease.create(
      'redis',
      'redis:7.4-alpine',
      ['--network-alias', 'redis', '--tmpfs', '/data'],
      [
        'redis-server',
        '--save',
        '',
        '--appendonly',
        'no',
        '--requirepass',
        lease.credentials.redisPassword,
      ],
    );
    lease.start(redis);
    await lease.poll(
      () => {
        try {
          return (
            lease.exec(redis, [
              'env',
              `REDISCLI_AUTH=${lease.credentials.redisPassword}`,
              'redis-cli',
              'ping',
            ]) === 'PONG'
          );
        } catch {
          return false;
        }
      },
      15000,
      'Redis PONG',
    );
    report.cases.push({
      name: 'internal-network-authenticated-mongo-replica-set-and-redis',
      passed: true,
      mongoPrimary: lease.mongoEval(mongo, 'print(db.hello().isWritablePrimary)') === 'true',
    });
    report.backends = [];
    for (const role of ['backend-a', 'backend-b']) {
      const id = lease.backend(role, lease.config('test'));
      lease.start(id);
      await lease.poll(() => lease.health(id), 60000, `${role} boot`);
      const identity = JSON.parse(
        lease.exec(id, [
          'node',
          '-e',
          "const fs=require('fs');console.log(JSON.stringify({uid:process.getuid(),pid1:fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean)}))",
        ]),
      );
      if (
        identity.uid === 0 ||
        JSON.stringify(identity.pid1) !== JSON.stringify(['node', 'src/server.js'])
      )
        throw new Error('Backend PID1 or user mismatch');
      report.backends.push({ id, role, image: lease.verify(id).image, ready: true, ...identity });
    }
    if (
      report.backends[0].image !== candidate.image.id ||
      report.backends[1].image !== candidate.image.id
    )
      throw new Error('Candidate image mismatch');
    report.cases.push({
      name: 'two-backends-real-server-entrypoint-same-image-shared-fixtures',
      passed: true,
      nodeEnv: 'test',
      strictBootClaimed: false,
    });
    report.exitCode = 0;
  } catch (error) {
    report.exitCode = 1;
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    report.cleanupExitCode = await lease.cleanup();
    if (report.cleanupExitCode) process.exitCode = 1;
    fs.writeFileSync('artifacts/round-a/phase2.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.log('Phase 2 harness failed');
  process.exitCode = 1;
});
