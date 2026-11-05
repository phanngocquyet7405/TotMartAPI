const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const topology = require('../roundB/topology');
const { check } = require('../roundB/close-runtime-check');
const { candidate } = require('../roundB/image-fixture');
const { directory } = require('../roundB/close-context');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const { boundedReadFailure } = require('./sse-deadline');
const output = directory();
assert(output && output.startsWith(path.resolve('artifacts/round-c2') + path.sep));
const report = {
  scenario: 'mongo-disconnect-reconnect-SSE-diagnosis',
  startedAt: Date.now(),
  image: candidate.image.id,
  timeline: [],
  clocks: {
    deadlineFromFaultActivationMs: 65000,
    watcherSafetyCeilingAfterFaultMs: 120000,
    independentObserverSafetyCeilingMs: 180000,
  },
  sourceBehaviorChanged: true,
  baseImageUnchanged: true,
  sourceOverlayFile: 'src/controllers/notificationController.js',
  otherFaultsRun: false,
};
const save = () =>
  fs.writeFileSync(path.join(output, 'mongo-sse.json'), JSON.stringify(report, null, 2));
function stage(name, fields = {}) {
  report.stage = name;
  report.timeline.push({ at: Date.now(), name, ...fields });
  save();
}
let t,
  disconnected = false;
function read(id, file, lines = false) {
  try {
    const text = t.lease.exec(id, ['cat', '/fixture/' + file], 10000);
    return lines
      ? text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : JSON.parse(text);
  } catch {
    return { unavailable: true };
  }
}
function snapshot(name) {
  const row = {
    at: Date.now(),
    legacyReady: read(t.client, 'watch-ready.json'),
    legacyResult: read(t.client, 'watch-result.json'),
    legacyExit: read(t.client, 'sse-legacy-exit.json'),
    legacyEvents: read(t.client, 'sse-legacy-events.jsonl', true),
    independent: read(t.client, 'sse-independent.json'),
    independentEvents: read(t.client, 'sse-independent-events.jsonl', true),
    backends: t.backends.map((id) => ({
      id,
      state: read(id, 'sse-server-state.json'),
      events: read(id, 'sse-server-events.jsonl', true),
      snapshots: read(id, 'sse-server-snapshots.jsonl', true),
    })),
    proxy: {
      state: read(t.proxy, 'sse-server-state.json'),
      events: read(t.proxy, 'sse-server-events.jsonl', true),
    },
  };
  fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(row, null, 2));
  report.snapshots ??= [];
  report.snapshots.push({ name, at: row.at });
  save();
  return row;
}
async function main() {
  try {
    const disk = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" -ErrorAction Stop | Select-Object Size,FreeSpace | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    assert(disk.FreeSpace > 10 * 1024 ** 3);
    report.disk = disk;
    const inventory = (args) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n');
    report.originalContainers = inventory([
      'ps',
      '-a',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Names}}',
    ]);
    report.originalImages = inventory([
      'image',
      'ls',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Repository}}:{{.Tag}}',
    ]);
    fs.writeFileSync(
      path.join(output, 'diagnostic-source.json'),
      JSON.stringify(require('./manifest').manifest(), null, 2),
    );
    stage('setup');
    t = await topology('c2-mongo-sse', {
      observerSource: 'tests/helpers/roundC2/sse-server-observer.js',
      proxyObserverSource: 'tests/helpers/roundC2/sse-server-observer.js',
      notificationSource: 'src/controllers/notificationController.js',
    });
    report.run = t.lease.run;
    report.runtime = t.backends.map((id) => check(t.lease, id));
    report.sourceOverlay = t.backends.map((id) => read(id, 'source-overlay.json'));
    for (const name of ['sse-client-observer', 'sse-legacy-launcher', 'sse-independent-client'])
      t.lease.copyFile(
        'tests/helpers/roundC2/' + name + '.js',
        t.client,
        '/fixture/' + name + '.js',
      );
    report.arm = t.run('fault-arm');
    assert(report.arm.passed);
    t.lease.exec(t.client, [
      'node',
      '-e',
      "const fs=require('fs');fs.writeFileSync('/fixture/sse-observer-ready-owner.json',JSON.stringify({run:process.env.FIXTURE_RUN}));",
    ]);
    t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/sse-independent-client.js']);
    await t.lease.poll(
      () => read(t.client, 'sse-independent.json').ready === true,
      15000,
      'Independent observer barrier',
    );
    t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/sse-legacy-launcher.js']);
    await t.lease.poll(
      () => read(t.client, 'watch-ready.json').opened === true,
      15000,
      'Legacy SSE barrier',
    );
    stage('watchers-ready');
    snapshot('before-fault');
    const id = t.lease.verify(t.mongo).id;
    report.targetId = id;
    t.lease.verify(t.lease.resources.find((r) => r.type === 'network').id);
    stage('disconnect-start');
    report.faultAt = Date.now();
    report.deadlineAt = report.faultAt + 65000;
    t.lease.exec(t.client, [
      'node',
      '-e',
      "require('fs').writeFileSync('/fixture/sse-fault-control.json',process.argv[1])",
      JSON.stringify({ run: t.lease.run, faultAt: report.faultAt, deadlineAt: report.deadlineAt }),
    ]);
    t.lease.docker(['network', 'disconnect', t.lease.networkName, id]);
    disconnected = true;
    report.disconnectCompletedAt = Date.now();
    save();
    try {
      await t.lease.poll(
        () => t.backends.every((backend) => !t.lease.health(backend)),
        20000,
        'Readiness detects Mongo fault',
      );
      stage('http-probes-start');
      report.observed = t.run('fault-observe', 140000);
      assert(report.observed.passed);
      report.requests = read(t.client, 'fault-observe-evidence.json');
      stage('legacy-outer-closure-start');
      report.outerStartAt = Date.now();
      save();
      try {
        await t.lease.poll(
          () => read(t.client, 'watch-result.json').passed === true,
          Math.max(1, report.deadlineAt - Date.now()),
          'SSE closure',
        );
        report.legacyGatePassed = true;
        stage('legacy-closure-observed');
      } catch (error) {
        report.legacyGatePassed = false;
        report.gateFailure = {
          classification: 'chưa xác định',
          stage: 'legacy-SSE-closure',
          errorType: error.name,
          deadlineExceeded: error.message === 'SSE closure deadline exceeded',
          at: Date.now(),
        };
        stage('legacy-closure-failed');
      }
      report.outerEndedAt = Date.now();
      const proof = snapshot('before-recovery');
      assert.equal(proof.legacyResult.passed, true);
      assert.equal(proof.legacyResult.deadlineAt, report.deadlineAt);
      assert(proof.legacyResult.endAt <= report.deadlineAt);
      await t.lease.poll(
        () => Number.isFinite(read(t.client, 'sse-legacy-exit.json').endedAt),
        5000,
        'Watcher exit',
      );
      const watcher = read(t.client, 'sse-legacy-exit.json');
      assert.equal(watcher.exitCode, 0);
      assert.equal(watcher.records.length, 1);
      assert.equal(watcher.records[0].passed, true);
      for (const label of ['independent-proxy', 'direct']) {
        const stream = proof.independent.streams[label];
        assert(
          stream.closed &&
            stream.endAt >= report.faultAt &&
            stream.endAt <= report.deadlineAt &&
            !stream.abortedAt &&
            !stream.localDestroyAt,
        );
        const state = proof.backends[1].state.streams.find((s) => s.label === label);
        assert(state.writableEnded);
        assert.equal(state.pendingQueries.length, 0);
        const events = proof.backends[1].events;
        const query = events.find(
          (e) => e.label === label && e.event === 'query_start' && e.at >= report.faultAt,
        );
        assert.equal(query.timeoutMS, 5000);
        const end = events.find((e) => e.event === 'query_end' && e.query === query.query);
        assert(boundedReadFailure(query, end));
        const closed = events.find(
          (e) => e.label === label && e.event === 'response_end' && e.at >= end.at,
        );
        assert(closed && closed.at <= report.deadlineAt);
        assert(
          events.some(
            (e) => e.label === label && e.event === 'response_finish' && e.at <= report.deadlineAt,
          ),
        );
        assert(
          events.some(
            (e) => e.label === label && e.event === 'heartbeat_clear' && e.at <= closed.at,
          ),
        );
      }
      report.remoteClosureVerified = true;
    } finally {
      stage('reconnect-start');
      t.lease.verify(id);
      t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, id]);
      disconnected = false;
      report.recoveryAt = Date.now();
      await t.lease.poll(
        () => t.backends.every((backend) => t.lease.health(backend)),
        45000,
        'Mongo recovery readiness',
      );
      report.recovery = t.run('fault-recover', 90000);
      assert(report.recovery.passed);
      stage('recovered');
      snapshot('after-recovery');
    }
    report.observationCompleted = true;
  } catch (error) {
    report.error = { type: error.name, stage: report.stage };
  } finally {
    if (t) {
      if (disconnected) {
        try {
          t.lease.verify(t.mongo);
          t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, t.mongo]);
          disconnected = false;
        } catch {
          report.reconnectCleanupFailed = true;
        }
      }
      try {
        snapshot('final-observation');
        t.lease.exec(t.client, [
          'node',
          '-e',
          "require('fs').writeFileSync('/fixture/sse-observer-stop.json','{}')",
        ]);
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
        report.logGuardFailures = inspectPublishedLogs(logs, {
          markers: Object.values(t.lease.credentials).filter((v) => v !== 'fixture'),
        });
        assert.deepEqual(report.logGuardFailures, []);
        fs.writeFileSync(
          path.join(output, 'published-log-metadata.json'),
          JSON.stringify(
            logs.map((r) => ({
              time: r.time,
              level: r.level,
              event: r.event,
              requestId: r.requestId,
              ...(r.err ? { error: { type: r.err.type, code: r.err.code } } : {}),
            })),
            null,
            2,
          ),
        );
      } catch (error) {
        report.observationCleanupError = error.name;
      }
      report.cleanupExitCode = await t.cleanup();
    } else report.cleanupExitCode = report.error ? null : 0;
    report.endedAt = Date.now();
    report.gateExitCode = report.legacyGatePassed && report.remoteClosureVerified ? 0 : 1;
    report.diagnosticExitCode =
      report.observationCompleted &&
      !report.error &&
      !report.observationCleanupError &&
      report.cleanupExitCode === 0
        ? 0
        : 1;
    report.exitCode = report.diagnosticExitCode || report.gateExitCode;
    save();
    console.log(
      JSON.stringify({
        exitCode: report.exitCode,
        diagnosticExitCode: report.diagnosticExitCode,
        gateExitCode: report.gateExitCode,
        cleanupExitCode: report.cleanupExitCode,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
