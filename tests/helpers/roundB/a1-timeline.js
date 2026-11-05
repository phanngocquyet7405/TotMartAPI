const fs = require('node:fs');
const { sha256 } = require('../../../scripts/evidence-manifest');
const directory = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const original =
  'artifacts/round-b/auth-csot/outage45/56919647-e3ca-485b-9571-78e6a63e3bd3/report.json';
const raw = fs.readFileSync(original);
const report = JSON.parse(raw);
const rows = report.scenarios.map((s) => ({
  iteration: s.iteration,
  clientDeadlineMs: s.deadlineMs,
  configuredFaultHoldMs: report.faultWindowMs,
  disconnectRequestedAt: s.disconnectRequestedAt,
  disconnectCommandCompletedAt: s.disconnectedAt,
  reconnectCommandCompletedAt: s.reconnectedAt,
  observedDisconnectMs: s.reconnectedAt - s.disconnectedAt,
  immediateSnapshotAt: s.recovery.immediate.snapshot.at,
  immediateAfterReconnectMs: s.recovery.immediate.snapshot.at - s.reconnectedAt,
  delayedSnapshotAt: s.recovery.delayed.snapshot.at,
  delayedAfterReconnectMs: s.recovery.delayed.snapshot.at - s.reconnectedAt,
}));
fs.writeFileSync(
  directory + '/timeline-correction.json',
  JSON.stringify(
    {
      original,
      originalSha256: sha256(raw),
      rows,
      correction:
        '45s is the HTTP client deadline, not the duration of network disconnection. Each fault was deliberately held for 150s.',
      precision:
        'Client-container wall-clock samples bracket completed Docker commands; no packet-level failure onset or instantaneous Mongo recovery is established.',
      recovery:
        'Immediate snapshot follows reconnect plus fixture ping/read; delayed snapshot follows >=130s from reconnect; replay follows the delayed snapshot.',
    },
    null,
    2,
  ),
);
const columns = Object.keys(rows[0]);
fs.writeFileSync(
  directory + '/timeline-correction.csv',
  [columns.join(','), ...rows.map((row) => columns.map((k) => row[k] ?? '').join(','))].join('\n') +
    '\n',
);
console.log(JSON.stringify(rows));
