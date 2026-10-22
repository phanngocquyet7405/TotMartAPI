// Fixed contract: applied commit, original 503, same-key/body replay 201, one obligation.
// Commit attempt count is diagnostic only for code91, never an acceptance assertion.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const topology = require('./topology');
const { evidence } = require('./close-context');
const { check } = require('./close-runtime-check');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const observer = evidence('code91-observer.js.txt');
fs.writeFileSync(
  observer,
  fs.readFileSync('tests/helpers/roundB/mongo-observer.js', 'utf8') +
    '\n' +
    fs.readFileSync('tests/helpers/roundB/a2-commit-observer.js', 'utf8'),
);
const parse = (output, prefix) =>
  JSON.parse(
    output
      .split('\n')
      .findLast((line) => line.startsWith(prefix))
      .slice(prefix.length),
  );
async function main() {
  let t;
  const report = { name: 'applied-code91-503-same-key-201-one-obligation', passed: false };
  try {
    t = await topology('code91', {
      observerSource: observer,
      failpoints: true,
      mongoAckProxy: true,
    });
    report.run = t.lease.run;
    report.runtime = t.backends.map((id) => check(t.lease, id));
    for (const file of ['mongo-evidence-client', 'a2-commit-client'])
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
    t.lease.verify(t.mongo);
    t.lease.verify(t.ackProxy);
    t.lease.verify(t.backends[0]);
    report.result = parse(
      t.lease.exec(
        t.client,
        ['node', '/fixture/a2-commit-client.js', 'server-code91-contract'],
        150000,
      ),
      'A2_RESULT=',
    );
    assert(report.result.passed);
    assert(!report.result.p0 && !report.result.faultRecoveryFailed);
    assert.equal(report.result.initial.status, 503);
    assert(report.result.requests.slice(1).every((request) => request.status === 201));
    assert.equal(report.result.finalChecks.checkouts, 1);
    assert.equal(report.result.finalChecks.orders, 1);
    const held = report.result.proxy.events.find((event) => event.event === 'commit_reply_held');
    assert.equal(held.writeConcernCode, 91);
    assert(held.errorLabels.includes('UnknownTransactionCommitResult'));
    report.commitDiagnostics = t.lease
      .exec(t.backends[0], ['cat', '/fixture/a2-commits.jsonl'])
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
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
      markers: Object.values(t.lease.credentials).filter((value) => value !== 'fixture'),
    });
    assert.equal(report.logGuardFailures.length, 0);
    report.passed = true;
  } catch (error) {
    report.errorType = error.name;
    report.classification = report.result?.p0
      ? 'application P0 invariant'
      : 'undetermined; review stage and assertions';
  } finally {
    if (t) report.cleanupExitCode = await t.cleanup();
    report.exitCode = report.passed && report.cleanupExitCode === 0 ? 0 : 1;
    fs.writeFileSync(evidence('code91.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        passed: report.passed,
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
