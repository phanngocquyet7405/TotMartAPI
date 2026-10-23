const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const context = require('./close-context');
const root =
  context.directory() || JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const directory = root + '/workers-' + crypto.randomUUID();
fs.mkdirSync(directory, { recursive: true });
const observer = directory + '/preload.js.txt';
fs.writeFileSync(
  observer,
  fs.readFileSync('tests/helpers/roundB/mongo-observer.js', 'utf8') +
    '\n;(function(){\n' +
    fs.readFileSync('tests/helpers/roundB/a1-worker-preload.js', 'utf8') +
    '\n})();\n',
);
let kinds = ['backend', 'expiry', 'payment', 'delivery', 'notification', 'security'];
const only = process.argv.indexOf('--only');
if (only !== -1) {
  const names = process.argv[only + 1].split(',');
  kinds = kinds.filter((kind) => names.includes(kind));
  assert.equal(kinds.length, names.length);
}
const report = {
  directory,
  image: candidate.image.id,
  cases: [],
  resources: [],
  fixtureOnlyTimerControl: true,
  runtimeDatabaseOptionsUnchanged: true,
  limits: [
    'Manual invocation of real exported drains; scheduler wall-clock cadence is not asserted',
    'Killed workers cannot demonstrate an old paused worker resuming after lease expiry',
    'No provider call, true lost Mongo commit ACK or multi-node failover',
  ],
  cleanupExitCode: 0,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  let t;
  try {
    for (const kind of kinds) {
      const row = { kind, steps: [], passed: false };
      report.cases.push(row);
      console.log(JSON.stringify({ kind, stage: 'setup' }));
      t = await topology('a1-worker-' + kind + '-' + crypto.randomUUID().slice(0, 8), {
        observerSource: observer,
      });
      row.run = t.lease.run;
      if (context.directory())
        row.runtime = t.backends.map((id) => require('./close-runtime-check').check(t.lease, id));
      report.resources.push(...t.lease.resources);
      t.lease.copyFile(
        'tests/helpers/roundB/a1-worker-client.js',
        t.client,
        '/fixture/a1-worker-client.js',
      );
      const invoke = (action) => {
        const output = t.lease.exec(
          t.client,
          ['node', '/fixture/a1-worker-client.js', action, kind],
          45000,
        );
        const result = JSON.parse(
          output
            .split('\n')
            .findLast((l) => l.startsWith('A1_WORKER_RESULT='))
            .slice(17),
        );
        row.steps.push(result);
        assert(result.passed, 'Worker business assertion: ' + action);
        return result;
      };
      const read = (index, file) => {
        try {
          return JSON.parse(
            t.lease.exec(index === 2 ? t.client : t.backends[index], [
              'cat',
              '/fixture/' + file + '.json',
            ]),
          );
        } catch {
          return null;
        }
      };
      const arm = (index, action, worker) => {
        const id = crypto.randomUUID();
        const file = directory + '/command-' + id + '.json';
        fs.writeFileSync(file, JSON.stringify({ id, action, worker }));
        t.lease.copyFile(file, t.backends[index], '/fixture/command-' + id + '.json');
        return id;
      };
      const finish = async (index, id, expected = true) => {
        await t.lease.poll(
          () => read(index, 'result-' + id),
          30000,
          'Bounded worker command result',
        );
        const result = read(index, 'result-' + id);
        row.steps.push({ index, commandId: id, ...result });
        assert.equal(result.ok, expected, 'Real worker command outcome');
      };
      const command = async (index, action, worker, expected = true) =>
        finish(index, arm(index, action, worker), expected);
      const compete = (worker) =>
        Promise.all([command(0, 'drain', worker), command(1, 'drain', worker)]);
      const kill = () => {
        t.lease.verify(t.backends[0]);
        t.lease.docker(['kill', '--signal', 'SIGKILL', t.backends[0]]);
        const state = t.lease.verify(t.backends[0]).state;
        assert.equal(state.Running, false);
        assert.equal(state.ExitCode, 137);
        row.steps.push({
          action: 'linux-pid1-SIGKILL',
          id: t.backends[0],
          exitCode: state.ExitCode,
          at: Date.now(),
        });
      };
      const restart = async () => {
        t.lease.start(t.backends[0]);
        t.lease.copyFile(observer, t.backends[0], '/fixture/mongo-observer.js');
        await t.lease.poll(
          () => t.lease.health(t.backends[0]),
          45000,
          'Restarted real server readiness',
        );
        row.steps.push({ action: 'restart-ready', at: Date.now() });
      };
      const waitUntil = async (at) => {
        while (Date.now() < at) {
          console.log(JSON.stringify({ kind, naturalWaitRemainingMs: at - Date.now() }));
          await delay(Math.min(10000, at - Date.now()));
        }
      };
      if (kind === 'security') {
        t.lease.docker([
          'exec',
          '-d',
          t.client,
          'node',
          '/fixture/a1-worker-client.js',
          'watch-security',
          kind,
        ]);
        await t.lease.poll(
          () => read(2, 'security-watcher-ready')?.ready,
          15000,
          'Security PubSub subscription barrier',
        );
      }
      invoke('setup');
      if (kind === 'backend') {
        kill();
        invoke('replay-survivor');
        await restart();
        invoke('replay-survivor');
      } else if (kind === 'expiry') {
        await command(0, 'fail-expiry-once');
        await command(0, 'drain', 'expiry');
        await t.lease.poll(() => read(0, 'event-expiry-failed'), 5000, 'Expiry fault barrier');
        invoke('expiry-rollback-check');
        kill();
        await restart();
        await compete('expiry');
        invoke('expiry-check');
        await compete('expiry');
        invoke('expiry-check');
      } else if (kind === 'payment' || kind === 'delivery') {
        await compete('delivery');
        invoke('unpaid-delivery-check');
        if (kind === 'payment') await command(0, 'fail-payment-once');
        invoke('pay');
        if (kind === 'payment') {
          await t.lease.poll(
            () => read(0, 'event-payment-failed'),
            5000,
            'Allocation fault barrier',
          );
          kill();
          await restart();
          await compete('payment');
        }
        invoke('paid-check');
        if (kind === 'delivery') {
          await command(0, 'fail-delivery-once');
          await command(0, 'drain', 'delivery', false);
          await t.lease.poll(
            () => read(0, 'event-delivery-failed'),
            5000,
            'Post-upsert fault barrier',
          );
          invoke('delivery-check');
          kill();
          await restart();
          await compete('delivery');
          invoke('delivery-check');
        } else {
          await compete('payment');
          invoke('paid-check');
        }
      } else if (kind === 'notification') {
        await command(0, 'hold-notification-claim');
        arm(0, 'drain', 'notification');
        await t.lease.poll(
          () => read(0, 'event-notification-held'),
          5000,
          'Notification durable claim barrier',
        );
        const held = invoke('notification-held-check');
        kill();
        await restart();
        await command(1, 'drain', 'notification');
        invoke('notification-held-check');
        await waitUntil(held.leaseUntil + 100);
        await command(0, 'fail-notification-once');
        await command(0, 'drain', 'notification');
        const retry = invoke('notification-backoff-check');
        await waitUntil(retry.nextAttempt + 100);
        await compete('notification');
        invoke('notification-check');
        await compete('notification');
        invoke('notification-check');
      } else if (kind === 'security') {
        await command(0, 'hold-security-after-publish');
        arm(0, 'drain', 'security');
        await t.lease.poll(
          () => read(0, 'event-security-held'),
          5000,
          'Published-before-marker barrier',
        );
        const held = invoke('security-held-check');
        const event = read(0, 'event-security-held');
        await t.lease.poll(
          () => read(2, 'security-deliveries')?.[event.recordId] === 1,
          5000,
          'First PubSub delivery',
        );
        kill();
        await restart();
        await waitUntil(held.leaseUntil + 100);
        await compete('security');
        invoke('security-check');
        await t.lease.poll(
          () => read(2, 'security-deliveries')?.[event.recordId] >= 2,
          5000,
          'At-least-once redelivery',
        );
        row.transportDeliveries = read(2, 'security-deliveries')[event.recordId];
        await compete('security');
        invoke('security-check');
      }
      row.logsGuard = inspectPublishedLogs(
        t.backends.flatMap((id) =>
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
        ),
        { markers: Object.values(t.lease.credentials).filter((v) => v !== 'fixture') },
      );
      assert.equal(row.logsGuard.length, 0);
      row.passed = true;
      fs.writeFileSync(directory + '/' + kind + '.json', JSON.stringify(row, null, 2));
      console.log(JSON.stringify({ kind, passed: true }));
      row.cleanupExitCode = await t.cleanup();
      report.cleanupExitCode ||= row.cleanupExitCode;
      t = undefined;
      assert.equal(row.cleanupExitCode, 0, 'Cleanup stop gate');
    }
  } catch (error) {
    report.failure = { type: error.name, message: error.message };
  } finally {
    if (t) report.cleanupExitCode ||= await t.cleanup();
    report.counts = {
      pass: report.cases.filter((c) => c.passed).length,
      fail: report.cases.filter((c) => !c.passed).length,
      skip: 0,
      notRun: kinds.length - report.cases.length,
    };
    report.exitCode =
      report.failure || report.cleanupExitCode || report.counts.fail || report.counts.notRun
        ? 1
        : 0;
    fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2));
    fs.writeFileSync(root + '/workers-latest.txt', directory);
    console.log(
      JSON.stringify({
        directory,
        counts: report.counts,
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
        failure: report.failure,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
