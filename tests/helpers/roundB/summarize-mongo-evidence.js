// Read-only evidence synthesis; this verifier never creates a seal or authorizes a BE change.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { sha256, sourceManifest } = require('../../../scripts/evidence-manifest');
const root = fs.readFileSync('artifacts/round-b/mongo-disconnect/latest.txt', 'utf8').trim();
const batch = JSON.parse(fs.readFileSync(root + '/report.json'));
const rows = [];
const results = [];
const dependsOnMongo = new Set([
  '/api/home/health',
  '/api/home/login',
  '/api/checkout/check-out',
  '/api/admin/notifications/stream-ticket',
  '/api/admin/notifications/stream',
]);
const readOnlyDocker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function csv(values, keys) {
  const cell = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return (
    [keys.join(','), ...values.map((row) => keys.map((key) => cell(row[key])).join(','))].join(
      '\n',
    ) + '\n'
  );
}
for (const run of batch.scenarios) {
  assert(run.actualFaultMs >= batch.faultWindowMs);
  assert(run.recovery.delayed.snapshot.at - run.reconnectedAt >= batch.delayedSnapshotMs);
  const outages = run.requests.filter((row) => row.purpose === 'outage checkout');
  const expectedReplay = run.requests.find(
    (row) => row.purpose === 'same-key recovery' && row.status === 201,
  )?.body?.dataHash;
  for (const row of outages.filter((row) => row.status === 201))
    assert.equal(row.body.dataHash, expectedReplay);
  for (const request of run.requests) {
    const phase = request.purpose.includes('recovery')
      ? 'same-key recovery'
      : request.purpose.includes('new-key')
        ? 'new purchase'
        : request.startedAt < run.disconnectedAt
          ? 'before fault'
          : request.startedAt < run.reconnectedAt
            ? 'outage'
            : 'after reconnect';
    const queries = request.mongo?.filter((event) => event.event === 'query_start') || [];
    const tx =
      request.mongo?.filter((event) => event.event === 'command_start' && event.transaction) || [];
    rows.push({
      ...request,
      body: request.body ?? null,
      phase,
      endAfterDisconnectMs: request.endedAt ? request.endedAt - run.disconnectedAt : null,
      endAfterReconnectMs: request.endedAt ? request.endedAt - run.reconnectedAt : null,
      dependsOnMongo: dependsOnMongo.has(request.path),
      timeToHeadersMs: request.responseHeadersAt
        ? request.responseHeadersAt - request.startedAt
        : null,
      queryCount: queries.length,
      transactionCommands: tx.length,
    });
  }
  const counts = (value) =>
    value?.snapshot
      ? Object.fromEntries(
          Object.entries(value.snapshot.collections).map(([name, items]) => [name, items.length]),
        )
      : null;
  const outcomes = outages.map((request) => {
    const starts = request.mongo.filter((event) => event.event === 'query_start');
    const first = starts[0],
      end = request.mongo.find(
        (event) => event.event === 'query_end' && event.queryId === first?.queryId,
      );
    const tx = request.mongo.filter(
      (event) => event.event === 'command_start' && event.transaction,
    );
    return {
      backend: request.index === 0 ? 'production' : 'staging',
      outcome: request.outcome,
      status: request.status,
      clientDurationMs: request.durationMs,
      clientDeadlineMs: request.deadlineMs,
      clientRequestId: request.xRequestId,
      serverRequestId: request.serverRequestId,
      transport: request.transport || null,
      firstQuery: first
        ? {
            model: first.model,
            operation: first.operation,
            timeoutMS: first.timeoutMS,
            maxTimeMS: first.maxTimeMS,
            transaction: first.transaction,
            startedAt: first.at,
          }
        : null,
      firstQueryEnd: end
        ? {
            endedAt: end.at,
            durationMs: end.durationMs,
            outcome: end.outcome,
            errorType: end.errorType,
          }
        : null,
      firstTransactionAt: tx[0]?.at || null,
      transactionsBeforeClientEnd: tx.filter((event) => event.at <= request.endedAt).length,
      transactionsAfterClientEnd: tx.filter((event) => event.at > request.endedAt).length,
      logCount: request.logs.length,
    };
  });
  const replay = run.recovery.replay;
  if (replay?.passed) {
    const [old, newer] = replay.snapshots;
    for (const snapshot of [old, newer]) {
      for (const checkout of snapshot.collections.Checkout) {
        const attempt = snapshot.collections.CheckoutAttempt.find(
          (row) => row.keyEncrypted === checkout.requestKeyEncrypted,
        );
        assert(attempt);
        assert.equal(attempt.hash, checkout.requestHash);
      }
    }
  }
  results.push({
    variant: run.variant,
    iteration: run.iteration,
    run: run.run,
    faultMs: run.actualFaultMs,
    delayedSnapshotMs: run.recovery.delayed?.snapshot?.at - run.reconnectedAt,
    consistencyPassed: run.consistencyPassed,
    availabilityPassed: run.availabilityPassed,
    lateSnapshotChanged: run.lateSnapshotChanged,
    immediate: counts(run.recovery.immediate),
    delayed: counts(run.recovery.delayed),
    finalChecks: replay?.checks,
    newPurchaseChecks: replay?.normalChecks,
    outages: outcomes,
    exitCode: run.exitCode,
    cleanupExitCode: run.cleanupExitCode,
    logGuardFailures: run.logGuardFailures,
    driverVersions: run.driverVersions,
  });
}
const groups = new Map();
for (const row of rows.filter((row) => row.dependsOnMongo && !row.purpose.startsWith('internal'))) {
  const key = JSON.stringify([row.variant, row.index, row.phase, row.method, row.path]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const table = [...groups.values()].map((group) => ({
  variant: group[0].variant,
  backend: group[0].index === 0 ? 'production' : 'staging',
  phase: group[0].phase,
  method: group[0].method,
  path: group[0].path,
  requests: group.length,
  httpResponses: group.filter(
    (row) => row.outcome === 'http_response' || row.outcome === 'sse_closed',
  ).length,
  statuses: [...new Set(group.map((row) => row.status ?? 'NO_RESPONSE'))].join('|'),
  clientRequestIds: group.filter((row) => row.xRequestId).length,
  serverRequestIds: group.filter((row) => row.serverRequestId).length,
  clientTimeouts: group.filter((row) => row.outcome === 'client_timeout').length,
  transportErrors: group.filter((row) =>
    ['transport_error', 'response_aborted', 'response_parse_error'].includes(row.outcome),
  ).length,
  minMs: Math.min(...group.map((row) => row.durationMs || 0)),
  maxMs: Math.max(...group.map((row) => row.durationMs || 0)),
  sseLongLived: group[0].path.endsWith('/stream'),
  maxTimeToHeadersMs: Math.max(...group.map((row) => row.timeToHeadersMs || 0)),
}));
fs.writeFileSync(root + '/route-summary.csv', csv(table, Object.keys(table[0] || {})));
fs.writeFileSync(root + '/requests-complete.json', JSON.stringify(rows, null, 2) + '\n');
fs.writeFileSync(
  root + '/requests-complete.csv',
  csv(rows, [
    'variant',
    'iteration',
    'index',
    'phase',
    'purpose',
    'path',
    'method',
    'keyEncrypted',
    'startedAt',
    'endedAt',
    'startAfterDisconnectMs',
    'startAfterReconnectMs',
    'endAfterDisconnectMs',
    'endAfterReconnectMs',
    'durationMs',
    'timeToHeadersMs',
    'outcome',
    'status',
    'xRequestId',
    'serverRequestId',
    'deadlineMs',
    'transportCode',
  ]),
);
const containers = readOnlyDocker([
  'ps',
  '-a',
  '--no-trunc',
  '--format',
  '{{.ID}} {{.Names}}',
]).split('\n');
const networks = readOnlyDocker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n');
const images = readOnlyDocker([
  'image',
  'ls',
  '--no-trunc',
  '--format',
  '{{.ID}} {{.Repository}}:{{.Tag}}',
]).split('\n');
const resources = [];
for (const run of batch.scenarios)
  for (const resource of run.resources || [])
    resources.push({
      ...resource,
      absent:
        resource.type === 'network'
          ? !networks.includes(resource.id)
          : !containers.some((line) => line.startsWith(resource.id + ' ')),
    });
for (const name of fs
  .readdirSync('artifacts/round-b')
  .filter((name) => /^(mongo-evidence-|mongo-module-probe-).*resources\.json$/.test(name))) {
  const evidence = JSON.parse(fs.readFileSync('artifacts/round-b/' + name));
  for (const resource of evidence.resources || []) {
    assert.equal(resource.owner, evidence.run);
    if (resources.some((row) => row.id === resource.id)) continue;
    resources.push({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      absent:
        resource.type === 'network'
          ? !networks.includes(resource.id)
          : !containers.some((line) => line.startsWith(resource.id + ' ')),
    });
  }
}
const current = sourceManifest();
const application = Object.fromEntries(
  Object.entries(current).filter(([file]) => file.startsWith('src/')),
);
const historical = JSON.parse(fs.readFileSync('artifacts/round-b/entry-current.json')).historicalA;
const verification = {
  applicationUnchanged: JSON.stringify(application) === JSON.stringify(batch.applicationBefore),
  originalContainersUnchanged: batch.entry.containers.every((line) => containers.includes(line)),
  originalImagesUnchanged: batch.entry.images.every((line) => images.includes(line)),
  resources,
  allAbsent: resources.every((row) => row.absent),
  historicalAUnchanged: Object.entries(historical).every(
    ([file, hash]) => sha256(fs.readFileSync(file)) === hash,
  ),
  sealGenerated: false,
  workerB01: 'NOT-RUN',
};
assert(
  verification.applicationUnchanged &&
    verification.originalContainersUnchanged &&
    verification.originalImagesUnchanged &&
    verification.allAbsent &&
    verification.historicalAUnchanged,
);
const files = [
  'tests/helpers/roundB/adapter.js',
  'tests/helpers/roundB/fault-client.js',
  'tests/helpers/roundB/faults.js',
  'tests/helpers/roundB/topology.js',
  'tests/helpers/roundB/mongo-observer.js',
  'tests/helpers/roundB/mongo-evidence-client.js',
  'tests/helpers/roundB/mongo-evidence-runner.js',
  'tests/helpers/roundB/summarize-mongo-evidence.js',
];
verification.fullFiles = [];
for (const file of files) {
  const destination = root + '/full-files/' + file + '.txt';
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
  verification.fullFiles.push({
    source: file,
    export: destination,
    sha256: sha256(fs.readFileSync(file)),
  });
}
fs.writeFileSync(
  root + '/summary.json',
  JSON.stringify({ results, table, counts: batch.counts, verification }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    root,
    counts: batch.counts,
    verification: {
      applicationUnchanged: verification.applicationUnchanged,
      allAbsent: verification.allAbsent,
      resources: resources.length,
      historicalAUnchanged: verification.historicalAUnchanged,
    },
    outages: results.map((result) => ({
      variant: result.variant,
      iteration: result.iteration,
      outages: result.outages.map((row) => ({
        backend: row.backend,
        outcome: row.outcome,
        status: row.status,
        durationMs: row.clientDurationMs,
        readMs: row.firstQueryEnd?.durationMs,
      })),
      lateSnapshotChanged: result.lateSnapshotChanged,
    })),
  }),
);
