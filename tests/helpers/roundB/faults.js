const fs = require('node:fs');
const assert = require('node:assert/strict');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const report = { phase: 6, image: candidate.image.id, cases: [], faultsOneAtATime: true };
let t;
const save = () =>
  fs.writeFileSync('artifacts/round-b/phase6-faults.json', JSON.stringify(report, null, 2) + '\n');
async function main() {
  try {
    t = await topology('phase6-faults');
    report.run = t.lease.run;
    for (const name of ['redis-stop-start', 'redis-pause-unpause', 'mongo-disconnect-reconnect']) {
      const evidence = { name, passed: false };
      report.cases.push(evidence);
      save();
      evidence.arm = t.run('fault-arm');
      assert(evidence.arm.passed);
      t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/client.js', 'fault-watch']);
      await t.lease.poll(
        () => {
          try {
            return JSON.parse(t.lease.exec(t.client, ['cat', '/fixture/watch-ready.json'])).opened;
          } catch {
            return false;
          }
        },
        15000,
        'SSE armed',
      );
      const id = name.startsWith('redis') ? t.redis : t.mongo;
      t.lease.verify(id);
      evidence.resourceId = id;
      evidence.faultAt = Date.now();
      evidence.deadlineAt = evidence.faultAt + 65000;
      t.lease.exec(t.client, [
        'node',
        '-e',
        "require('fs').writeFileSync('/fixture/sse-fault-control.json',process.argv[1])",
        JSON.stringify({
          run: t.lease.run,
          faultAt: evidence.faultAt,
          deadlineAt: evidence.deadlineAt,
        }),
      ]);
      try {
        if (name === 'redis-stop-start') t.lease.docker(['stop', '--time', '1', id]);
        else if (name === 'redis-pause-unpause') t.lease.docker(['pause', id]);
        else {
          t.lease.verify(t.lease.resources.find((r) => r.type === 'network').id);
          t.lease.docker(['network', 'disconnect', t.lease.networkName, id]);
        }
        await t.lease.poll(
          () => t.backends.every((backend) => !t.lease.health(backend)),
          20000,
          'Readiness detects fault',
        );
        evidence.observed = t.run('fault-observe', 140000);
        evidence.observationRequests = JSON.parse(
          t.lease.exec(t.client, ['cat', '/fixture/fault-observe-evidence.json']),
        );
        if (evidence.observed.passed)
          await t.lease.poll(
            () => {
              try {
                return JSON.parse(t.lease.exec(t.client, ['cat', '/fixture/watch-result.json']))
                  .passed;
              } catch {
                return false;
              }
            },
            Math.max(1, evidence.deadlineAt - Date.now()),
            'Fault closes SSE',
          );
        evidence.sseClosed = true;
      } finally {
        t.lease.verify(id);
        if (name === 'redis-stop-start') t.lease.start(id);
        else if (name === 'redis-pause-unpause') t.lease.docker(['unpause', id]);
        else t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, id]);
        evidence.recoveryAt = Date.now();
        // Recovery evidence is mandatory even after an observation/assertion failure.
        try {
          await t.lease.poll(
            () => t.backends.every((backend) => t.lease.health(backend)),
            45000,
            'Recovery readiness',
          );
          evidence.readinessRecovered = true;
        } catch (error) {
          evidence.readinessRecovered = false;
          evidence.recoveryErrorType = error.name;
        }
        try {
          evidence.recovery = t.run('fault-recover', 60000);
        } catch (error) {
          evidence.recovery = { passed: false, errorType: error.name };
        }
        save();
      }
      assert(evidence.observed?.passed);
      assert(evidence.readinessRecovered);
      assert(evidence.recovery.passed);
      evidence.passed = true;
      save();
      console.log(JSON.stringify({ name, passed: true }));
    }
    report.exitCode = 0;
  } catch (error) {
    report.exitCode = 1;
    report.failureType = error.name;
    report.classification = 'unclassified; inspect safe scenario evidence before fixes';
    process.exitCode = 1;
  } finally {
    if (t) report.cleanupExitCode = await t.cleanup();
    report.counts = {
      passed: report.cases.filter((c) => c.passed).length,
      failed: report.cases.filter((c) => !c.passed).length,
      skipped: 0,
      notRun: 3 - report.cases.length,
    };
    save();
    console.log(
      JSON.stringify({
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
        counts: report.counts,
      }),
    );
    if (report.cleanupExitCode) process.exitCode = 1;
  }
}
const selected = process.argv.includes('--mongo-evidence')
  ? require('./mongo-evidence-runner').main
  : main;
selected().catch(() => {
  console.log('Fault runner failure');
  process.exitCode = 1;
});
