const fs = require('node:fs');
const assert = require('node:assert/strict');
const topology = require('./topology');
const { evidence } = require('./close-context');
const { check } = require('./close-runtime-check');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const names = [
  'redis-stop-start',
  'redis-pause-unpause',
  'mongo-disconnect-reconnect',
  'backend-kill-restart',
];
const report = { cases: [], faultsOneAtATime: true, cleanupExitCode: 0 };
const save = () => fs.writeFileSync(evidence('faults.json'), JSON.stringify(report, null, 2));
const parse = (value, prefix) =>
  JSON.parse(
    value
      .split('\n')
      .findLast((line) => line.startsWith(prefix))
      .slice(prefix.length),
  );
async function main() {
  let t;
  try {
    for (const name of names) {
      const row = { name, passed: false };
      report.cases.push(row);
      save();
      t = await topology('fault-' + name);
      row.run = t.lease.run;
      row.runtime = t.backends.map((id) => check(t.lease, id));
      if (name === 'backend-kill-restart') {
        for (const file of ['mongo-evidence-client', 'close-backend-client'])
          t.lease.copyFile(
            'tests/helpers/roundB/' + file + '.js',
            t.client,
            '/fixture/' + file + '.js',
          );
        assert(
          parse(
            t.lease.exec(t.client, ['node', '/fixture/mongo-evidence-client.js', 'setup'], 90000),
            'MONGO_EVIDENCE_RESULT=',
          ).passed,
        );
        const invoke = (action) =>
          parse(
            t.lease.exec(t.client, ['node', '/fixture/close-backend-client.js', action], 90000),
            'CLOSE_BACKEND_RESULT=',
          );
        row.prime = invoke('prime');
        assert(row.prime.passed);
        const target = t.backends[0];
        row.targetId = t.lease.verify(target).id;
        row.faultAt = Date.now();
        try {
          t.lease.docker(['kill', '--signal', 'SIGKILL', target]);
          assert.equal(t.lease.verify(target).state.ExitCode, 137);
          row.survivor = invoke('survivor');
          assert(row.survivor.passed);
        } finally {
          t.lease.verify(target);
          t.lease.start(target);
          await t.lease.poll(() => t.lease.health(target), 45000, 'Backend recovery readiness');
          row.recoveryAt = Date.now();
          row.recovery = invoke('restarted');
          save();
        }
        assert(row.recovery.passed);
      } else {
        row.arm = t.run('fault-arm');
        assert(row.arm.passed);
        t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/client.js', 'fault-watch']);
        await t.lease.poll(
          () => {
            try {
              return JSON.parse(t.lease.exec(t.client, ['cat', '/fixture/watch-ready.json']))
                .opened;
            } catch {
              return false;
            }
          },
          15000,
          'SSE barrier',
        );
        const id = name.startsWith('redis') ? t.redis : t.mongo;
        row.targetId = t.lease.verify(id).id;
        // Windows and the Docker VM need not share a wall clock. Stamp control
        // in the same fixture process environment as the watcher event times.
        const hostStarted = performance.now();
        row.hostFaultAt = Date.now();
        const control = JSON.parse(
          t.lease.exec(t.client, [
            'node',
            '-e',
            "const value=require('/fixture/sse-deadline').faultControl(process.env.FIXTURE_RUN);require('fs').writeFileSync('/fixture/sse-fault-control.json',JSON.stringify(value));console.log(JSON.stringify(value))",
          ]),
        );
        assert.equal(control.run, t.lease.run);
        row.clock = 'fixture-client';
        row.faultAt = control.faultAt;
        row.deadlineAt = control.deadlineAt;
        row.hostControlReceivedAt = Date.now();
        try {
          if (name === 'redis-stop-start') t.lease.docker(['stop', '--time', '1', id]);
          else if (name === 'redis-pause-unpause') t.lease.docker(['pause', id]);
          else {
            t.lease.verify(t.lease.resources.find((resource) => resource.type === 'network').id);
            t.lease.docker(['network', 'disconnect', t.lease.networkName, id]);
          }
          await t.lease.poll(
            () => t.backends.every((backend) => !t.lease.health(backend)),
            20000,
            'Readiness detects one fault',
          );
          row.observed = t.run('fault-observe', 140000);
          row.requests = JSON.parse(
            t.lease.exec(t.client, ['cat', '/fixture/fault-observe-evidence.json']),
          );
          await t.lease.poll(
            () => {
              try {
                row.watcher = JSON.parse(
                  t.lease.exec(t.client, ['cat', '/fixture/watch-result.json']),
                );
                return row.watcher.passed;
              } catch {
                return false;
              }
            },
            Math.max(1, 65000 - (performance.now() - hostStarted)),
            'SSE closure',
          );
          row.sseClosed = true;
        } finally {
          t.lease.verify(id);
          if (name === 'redis-stop-start') t.lease.start(id);
          else if (name === 'redis-pause-unpause') t.lease.docker(['unpause', id]);
          else t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, id]);
          row.recoveryAt = Date.now();
          await t.lease.poll(
            () => t.backends.every((backend) => t.lease.health(backend)),
            45000,
            'Recovery readiness',
          );
          row.recovery = t.run('fault-recover', 90000);
          save();
        }
        assert(row.observed.passed);
        assert(row.sseClosed);
        assert(row.recovery.passed);
      }
      const logs = t.backends.flatMap((id) =>
        t.lease
          .docker(['logs', id])
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          }),
      );
      row.logGuardFailures = inspectPublishedLogs(logs, {
        markers: Object.values(t.lease.credentials).filter((value) => value !== 'fixture'),
      });
      assert.equal(row.logGuardFailures.length, 0);
      row.cleanupExitCode = await t.cleanup();
      t = undefined;
      report.cleanupExitCode ||= row.cleanupExitCode;
      assert.equal(row.cleanupExitCode, 0);
      row.passed = true;
      save();
    }
  } catch (error) {
    report.errorType = error.name;
    report.classification = 'undetermined; review scenario evidence before fixes';
  } finally {
    if (t) {
      const code = await t.cleanup();
      report.cleanupExitCode ||= code;
    }
    report.counts = {
      pass: report.cases.filter((row) => row.passed).length,
      fail: report.cases.filter((row) => !row.passed).length,
      skip: 0,
      notRun: names.length - report.cases.length,
    };
    report.exitCode = report.counts.fail || report.counts.notRun || report.cleanupExitCode ? 1 : 0;
    save();
    console.log(
      JSON.stringify({
        counts: report.counts,
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
