const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const authCsot = process.argv.includes('--auth-csot-45');
const root = authCsot
  ? 'artifacts/round-b/auth-csot/outage45'
  : 'artifacts/round-b/mongo-disconnect';
const batch = randomUUID();
const directory = root + '/' + batch;
const report = {
  batch,
  image: candidate.image.id,
  scenarios: [],
  plannedRuns: authCsot ? 3 : 6,
  faultWindowMs: 150000,
  delayedSnapshotMs: 130000,
  applicationSourceChanged: false,
  workerB01Seal: 'NOT-RUN',
  instrumentation:
    'Test preload observes HTTP/query/driver; monitorCommands=true only, no timeout or transaction policy changed',
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const save = () =>
  fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
const parseLines = (text) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
function metadataDocker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function waitUntil(deadline, label) {
  let last = -1;
  while (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (Math.floor(remaining / 30) !== last) {
      last = Math.floor(remaining / 30);
      console.log(JSON.stringify({ phase: label, remainingSeconds: remaining }));
    }
    await delay(Math.min(1000, Math.max(1, deadline - Date.now())));
  }
}
function csv(rows) {
  const keys = [
    'variant',
    'iteration',
    'index',
    'purpose',
    'path',
    'method',
    'keyEncrypted',
    'startedAt',
    'startAfterDisconnectMs',
    'startAfterReconnectMs',
    'outcome',
    'status',
    'xRequestId',
    'serverRequestId',
    'durationMs',
    'deadlineMs',
    'transportCode',
  ];
  const escape = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return (
    [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join(
      '\n',
    ) + '\n'
  );
}
async function one(variant, iteration) {
  let t,
    disconnected = false;
  const result = {
    variant,
    iteration,
    deadlineMs: variant === '45s' ? 45000 : 240000,
    observe: {},
    recovery: {},
    requests: [],
  };
  report.scenarios.push(result);
  save();
  const runDir = directory + '/' + variant + '-' + iteration;
  fs.mkdirSync(runDir, { recursive: true });
  const stage = (name) => {
    result.stage = name;
    save();
    console.log(JSON.stringify({ variant, iteration, stage: name }));
  };
  function invoke(mode, timeout = 60000) {
    const output = t.lease.exec(
      t.client,
      ['node', '/fixture/mongo-evidence-client.js', mode],
      timeout,
    );
    const line = output.split('\n').findLast((line) => line.startsWith('MONGO_EVIDENCE_RESULT='));
    if (!line) throw Error('Diagnostic did not publish a safe result');
    const value = JSON.parse(line.slice('MONGO_EVIDENCE_RESULT='.length));
    fs.writeFileSync(runDir + '/' + mode + '.json', JSON.stringify(value, null, 2) + '\n');
    return value;
  }
  function readFile(name) {
    try {
      return t.lease.exec(t.client, ['cat', '/fixture/' + name], 10000);
    } catch {
      return null;
    }
  }
  function observer() {
    return t.backends.flatMap((id, index) => {
      try {
        return parseLines(t.lease.exec(id, ['cat', '/fixture/mongo-observer.jsonl'], 15000)).map(
          (value) => ({ ...value, index }),
        );
      } catch {
        return [];
      }
    });
  }
  try {
    stage('setup');
    t = await topology('mongo-evidence-' + batch.slice(0, 8) + '-' + variant + '-' + iteration, {
      observerSource: 'tests/helpers/roundB/mongo-observer.js',
    });
    result.run = t.lease.run;
    result.resources = t.lease.resources.map(({ id, name, type, role }) => ({
      id,
      name,
      type,
      role,
    }));
    t.lease.copyFile(
      'tests/helpers/roundB/mongo-evidence-client.js',
      t.client,
      '/fixture/mongo-evidence-client.js',
    );
    result.setup = invoke('setup');
    assert(result.setup.passed);
    t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/mongo-evidence-client.js', 'watch']);
    await t.lease.poll(
      () => {
        const value = readFile('watch-ready-evidence.json');
        return value && JSON.parse(value).opened;
      },
      15000,
      'SSE pre-fault barrier',
    );
    result.sseOpened = true;
    result.driverVersions = JSON.parse(
      t.lease.exec(t.client, [
        'node',
        '-e',
        "console.log(JSON.stringify({node:process.version,mongoose:require('mongoose/package.json').version,mongodb:require('module').createRequire(require.resolve('mongoose'))('mongodb/package.json').version,redis:require('redis/package.json').version}))",
      ]),
    );
    result.beforeFaultHealth = invoke('health');
    assert(result.beforeFaultHealth.ready);
    stage('disconnect');
    const network = t.lease.resources.find((value) => value.type === 'network');
    t.lease.verify(network.id);
    t.lease.verify(t.mongo);
    result.disconnectRequestedAt = Date.now();
    t.lease.docker(['network', 'disconnect', t.lease.networkName, t.mongo]);
    disconnected = true;
    result.disconnectedAt = Number(
      t.lease.exec(t.client, ['node', '-e', 'console.log(Date.now())']),
    );
    const faultDeadline = Date.now() + report.faultWindowMs;
    try {
      t.lease.docker([
        'exec',
        '-d',
        t.client,
        'node',
        '/fixture/mongo-evidence-client.js',
        'outage',
        String(result.deadlineMs),
      ]);
      await t.lease.poll(
        () => {
          const value = readFile('mongo-requests.jsonl');
          return (
            value &&
            parseLines(value).filter(
              (row) => row.event === 'started' && row.purpose === 'outage checkout',
            ).length === 2
          );
        },
        25000,
        'Both checkout requests started during Mongo fault',
      );
      result.checkoutStartBarrier = true;
      const mid = observer();
      fs.writeFileSync(
        runDir + '/observer-fault-barrier.json',
        JSON.stringify(mid, null, 2) + '\n',
      );
      stage('fault-window');
      await waitUntil(faultDeadline, 'Mongo disconnected ' + variant + ' #' + iteration);
    } catch (error) {
      result.observe.harnessErrorType = error.name;
    } finally {
      stage('reconnect');
      t.lease.verify(t.mongo);
      t.lease.verify(network.id);
      t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, t.mongo]);
      disconnected = false;
      result.reconnectedAt = Number(
        t.lease.exec(t.client, ['node', '-e', 'console.log(Date.now())']),
      );
      result.actualFaultMs = result.reconnectedAt - result.disconnectedAt;
      // Always snapshot/recovery, independently of observations and assertion results.
      try {
        result.recovery.immediate = invoke('snapshot-reconnected');
      } catch (error) {
        result.recovery.immediate = { passed: false, errorType: error.name };
      }
      const delayedAt = result.reconnectedAt + report.delayedSnapshotMs;
      try {
        await t.lease.poll(
          () => {
            const value = invoke('health', 20000);
            return value.ready;
          },
          60000,
          'Post-reconnect readiness',
        );
        result.recovery.ready = true;
      } catch (error) {
        result.recovery.ready = false;
        result.recovery.readinessErrorType = error.name;
      }
      stage('late-commit-observation');
      await waitUntil(delayedAt, 'Post-reconnect 130s ' + variant + ' #' + iteration);
      try {
        result.recovery.delayed = invoke('snapshot-delayed');
      } catch (error) {
        result.recovery.delayed = { passed: false, errorType: error.name };
      }
      if (result.recovery.delayed?.invariantFailure) {
        result.invariantFailure = true;
        result.stopReason = 'P0/P1 invariant assertion: stop before any further scenario';
      } else {
        stage('same-key-replay-and-new-key');
        try {
          result.recovery.replay = invoke('recover', 160000);
        } catch (error) {
          result.recovery.replay = { passed: false, errorType: error.name };
        }
        if (result.recovery.replay?.invariantFailure) result.invariantFailure = true;
      }
    }
    const observed = readFile('result-outage.json');
    result.observe.client = observed
      ? JSON.parse(observed)
      : { passed: false, errorType: 'missing_outage_completion' };
    const events = parseLines(readFile('mongo-requests.jsonl') || '');
    const records = new Map();
    for (const event of events) records.set(event.trace, event);
    const observations = observer();
    fs.writeFileSync(runDir + '/observer.json', JSON.stringify(observations, null, 2) + '\n');
    const rawLogs = t.backends.flatMap((id, index) => {
      const text = t.lease.docker(['logs', id]);
      return text.split('\n').flatMap((line) => {
        try {
          return [{ index, ...JSON.parse(line) }];
        } catch {
          return [];
        }
      });
    });
    const guard = inspectPublishedLogs(rawLogs, {
      markers: Object.values(t.lease.credentials).filter((value) => value !== 'fixture'),
    });
    result.logGuardFailures = guard;
    const sanitizedLogs = rawLogs.map((value) => ({
      index: value.index,
      time: value.time,
      requestId: value.requestId || value.req?.id,
      path: (value.path || value.req?.url)?.split('?')[0],
      method: value.method || value.req?.method,
      status: value.status || value.res?.statusCode,
      event: value.event,
      msg: value.msg,
      err: value.err ? { type: value.err.type, code: value.err.code } : undefined,
      responseTime: value.responseTime,
    }));
    // No unfiltered log content is exported or printed.
    const safeLogs = JSON.parse(
      JSON.stringify(sanitizedLogs)
        .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s"\\]+/gi, '[REDACTED_URI]')
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]'),
    );
    for (const record of records.values()) {
      const related = observations.filter(
        (value) => value.trace === record.trace && value.index === record.index,
      );
      const serverRequestId =
        record.xRequestId || related.find((value) => value.requestId)?.requestId || null;
      result.requests.push({
        ...record,
        variant,
        iteration,
        serverRequestId,
        startAfterDisconnectMs: record.startedAt - result.disconnectedAt,
        startAfterReconnectMs: record.startedAt - result.reconnectedAt,
        transportCode: record.transport?.code || null,
        logs: safeLogs.filter(
          (value) =>
            value.index === record.index && serverRequestId && value.requestId === serverRequestId,
        ),
        mongo: related.filter((value) => !value.event.startsWith('http_')),
      });
    }
    // Include startup/internal readiness requests observed at server, without claiming client receipt.
    for (const start of observations.filter(
      (value) => value.event === 'http_start' && !value.trace,
    )) {
      const end = observations.find(
        (value) =>
          value.index === start.index &&
          value.observerHttpId === start.observerHttpId &&
          value.event === 'http_finish',
      );
      result.requests.push({
        variant,
        iteration,
        index: start.index,
        purpose: 'internal readiness; server observation',
        path: start.path,
        method: start.method,
        keyEncrypted: null,
        startedAt: start.at,
        endedAt: end?.at,
        durationMs: end ? end.at - start.at : null,
        status: end?.status || null,
        xRequestId: null,
        serverRequestId: end?.requestId || null,
        outcome: end
          ? 'server_response_finished_client_receipt_not_captured'
          : 'server_response_not_finished',
        startAfterDisconnectMs: start.at - result.disconnectedAt,
        startAfterReconnectMs: start.at - result.reconnectedAt,
        logs: safeLogs.filter((value) => end?.requestId && value.requestId === end.requestId),
        mongo: [],
      });
    }
    fs.writeFileSync(runDir + '/requests.json', JSON.stringify(result.requests, null, 2) + '\n');
    fs.writeFileSync(runDir + '/routes.csv', csv(result.requests));
    result.observe.availabilityViolations = result.requests
      .filter(
        (row) =>
          row.purpose === 'outage checkout' &&
          (row.outcome !== 'http_response' ||
            row.status !== 503 ||
            (authCsot &&
              (row.durationMs > 12000 || !/^[a-f0-9-]{36}$/.test(row.xRequestId || '')))),
      )
      .map((row) => ({
        index: row.index,
        outcome: row.outcome,
        status: row.status,
        durationMs: row.durationMs,
        deadlineMs: row.deadlineMs,
      }));
    result.consistencyPassed =
      !!result.recovery.delayed?.passed && !!result.recovery.replay?.passed;
    result.availabilityPassed = result.observe.availabilityViolations.length === 0;
    if (authCsot) {
      result.outageCheckoutCount = result.requests.filter(
        (row) => row.purpose === 'outage checkout',
      ).length;
      result.availabilityPassed =
        result.availabilityPassed &&
        result.outageCheckoutCount === 2 &&
        result.checkoutStartBarrier === true &&
        !result.observe.harnessErrorType &&
        result.logGuardFailures.length === 0;
    }
    result.exitCode = result.consistencyPassed && result.availabilityPassed ? 0 : 1;
    if (result.recovery.immediate?.snapshot && result.recovery.delayed?.snapshot)
      result.lateSnapshotChanged =
        result.recovery.immediate.snapshot.hash !== result.recovery.delayed.snapshot.hash;
    if (authCsot) {
      result.noOutageBusinessEffect =
        result.setup.snapshot.hash === result.recovery.immediate?.snapshot?.hash &&
        result.setup.snapshot.hash === result.recovery.delayed?.snapshot?.hash;
      if (!result.noOutageBusinessEffect) {
        result.invariantFailure = true;
        result.consistencyPassed = false;
        result.exitCode = 1;
      }
    }
  } catch (error) {
    result.exitCode = 1;
    result.harnessErrorType = error.name;
    result.harnessError =
      error.name === 'AssertionError'
        ? 'Diagnostic setup/invariant assertion; inspect stage evidence'
        : 'Diagnostic execution failed';
  } finally {
    if (t && disconnected) {
      try {
        t.lease.verify(t.mongo);
        t.lease.docker(['network', 'connect', '--alias', 'mongo', t.lease.networkName, t.mongo]);
        result.emergencyReconnect = true;
      } catch {
        result.emergencyReconnect = false;
      }
    }
    if (t) result.cleanupExitCode = await t.cleanup();
    fs.writeFileSync(runDir + '/result.json', JSON.stringify(result, null, 2) + '\n');
    save();
    console.log(
      JSON.stringify({
        variant,
        iteration,
        exitCode: result.exitCode,
        consistencyPassed: result.consistencyPassed,
        availabilityPassed: result.availabilityPassed,
        cleanupExitCode: result.cleanupExitCode,
      }),
    );
  }
  if (
    result.invariantFailure ||
    result.cleanupExitCode ||
    result.recovery.ready === false ||
    result.harnessErrorType
  )
    throw Error('Stop gate: inspect current diagnostic evidence');
}
async function main() {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(root + '/latest.txt', directory + '\n');
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const before = sourceManifest();
  fs.writeFileSync(directory + '/input-manifest.json', JSON.stringify(before, null, 2) + '\n');
  report.applicationBefore = Object.fromEntries(
    Object.entries(before).filter(([file]) => file.startsWith('src/')),
  );
  report.entry = {
    docker: JSON.parse(metadataDocker(['version', '--format', '{{json .Server}}'])),
    containers: metadataDocker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).split(
      '\n',
    ),
    images: metadataDocker([
      'image',
      'ls',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Repository}}:{{.Tag}}',
    ]).split('\n'),
  };
  report.inputSourceSha256 = sha256(JSON.stringify(before, null, 2) + '\n');
  save();
  try {
    for (const variant of authCsot ? ['45s'] : ['45s', '240s'])
      for (let iteration = 1; iteration <= 3; iteration++) await one(variant, iteration);
  } catch {
    report.stoppedByGate = true;
  }
  const after = sourceManifest();
  report.applicationAfter = Object.fromEntries(
    Object.entries(after).filter(([file]) => file.startsWith('src/')),
  );
  report.applicationUnchanged =
    JSON.stringify(report.applicationBefore) === JSON.stringify(report.applicationAfter);
  report.counts = {
    consistencyPassed: report.scenarios.filter((row) => row.consistencyPassed).length,
    consistencyFailed: report.scenarios.filter((row) => row.consistencyPassed === false).length,
    availabilityPassed: report.scenarios.filter((row) => row.availabilityPassed).length,
    availabilityFailed: report.scenarios.filter((row) => row.availabilityPassed === false).length,
    notRun: report.plannedRuns - report.scenarios.length,
  };
  report.exitCode =
    report.stoppedByGate ||
    report.counts.availabilityFailed ||
    report.counts.consistencyFailed ||
    !report.applicationUnchanged
      ? 1
      : 0;
  fs.writeFileSync(
    directory + '/all-routes.csv',
    csv(report.scenarios.flatMap((row) => row.requests)),
  );
  save();
  console.log(
    JSON.stringify({
      directory,
      counts: report.counts,
      exitCode: report.exitCode,
      applicationUnchanged: report.applicationUnchanged,
    }),
  );
  process.exitCode = report.exitCode;
}
module.exports = { main };
if (require.main === module) main();
