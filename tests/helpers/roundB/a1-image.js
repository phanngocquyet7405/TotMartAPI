const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a1/current.json')).directory;
const stage = process.argv.includes('--red') ? 'red' : 'green';
const directory = root + '/' + stage + '-' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
let probes = [
  { name: 'replay-outside-transaction', collection: 'checkouts', model: 'Checkout' },
  { name: 'prepare-initial-attempt', collection: 'checkoutattempts', model: 'CheckoutAttempt' },
  { name: 'prepare-user-address', collection: 'users', model: 'User', skip: 1 },
  {
    name: 'prepare-duplicate-recovery',
    collection: 'checkoutattempts',
    model: 'CheckoutAttempt',
    duplicate: true,
  },
];
const selected = process.argv.indexOf('--only');
if (selected !== -1) {
  const names = process.argv[selected + 1].split(',');
  probes = probes.filter((p) => names.includes(p.name));
  assert.equal(probes.length, names.length);
}
const report = {
  directory,
  stage,
  image: candidate.image.id,
  probes: [],
  cleanupExitCode: 0,
  logGuardFailures: [],
};
async function main() {
  let t;
  try {
    for (const probe of probes) {
      console.log(JSON.stringify({ probe: probe.name, stage }));
      let observerSource = 'tests/helpers/roundB/mongo-observer.js';
      if (probe.duplicate) {
        observerSource = directory + '/duplicate-preload.js.txt';
        fs.writeFileSync(
          observerSource,
          fs.readFileSync('tests/helpers/roundB/mongo-observer.js', 'utf8') +
            '\n;(function(){\n' +
            fs
              .readFileSync('tests/helpers/roundB/a1-duplicate-observer.js', 'utf8')
              .replace("require('./mongo-observer');", '') +
            '\n})();\n',
        );
      }
      t = await topology('a1-' + stage + '-' + randomUUID().slice(0, 8), {
        observerSource,
        failpoints: true,
      });
      report.resources ||= [];
      report.resources.push(...t.lease.resources);
      for (const file of ['mongo-evidence-client', 'a1-client'])
        t.lease.copyFile(
          'tests/helpers/roundB/' + file + '.js',
          t.client,
          '/fixture/' + file + '.js',
        );
      const invoke = (mode) => {
        const output = t.lease.exec(
          t.client,
          ['node', '/fixture/mongo-evidence-client.js', mode],
          90000,
        );
        return JSON.parse(
          output
            .split('\n')
            .findLast((l) => l.startsWith('MONGO_EVIDENCE_RESULT='))
            .slice(22),
        );
      };
      const before = invoke('setup');
      assert(before.passed, 'Fixture setup');
      const output = t.lease.exec(
        t.client,
        ['node', '/fixture/a1-client.js', JSON.stringify(probe)],
        75000,
      );
      const row = JSON.parse(
        output
          .split('\n')
          .findLast((l) => l.startsWith('A1_RESULT='))
          .slice(10),
      );
      Object.assign(row, { run: t.lease.run, before: before.snapshot });
      report.probes.push(row);
      // Recovery is mandatory even after a red application assertion.
      row.recovery = invoke('recover');
      const observations = t.lease
        .exec(t.backends[0], ['cat', '/fixture/mongo-observer.jsonl'])
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      row.mongo = observations.filter((e) => e.trace === row.request?.trace);
      const queries = row.mongo.filter(
        (e) => e.event === 'query_start' && !e.transaction && e.model === probe.model,
      );
      const target = probe.duplicate ? queries.at(-1) : queries[probe.skip || 0];
      const end = row.mongo.find((e) => e.event === 'query_end' && e.queryId === target?.queryId);
      row.target = { start: target, end };
      row.targetProven = !!target && !!end && !!row.barrierAt;
      row.noContinuation =
        !!end &&
        !row.mongo.some(
          (e) =>
            e.at > end.at &&
            (e.event === 'query_start' ||
              (e.event === 'command_start' &&
                ['insert', 'update', 'commitTransaction'].includes(e.command))),
        );
      row.snapshotUnchanged = row.before.hash === row.snapshot?.hash;
      row.passed =
        row.passed &&
        row.targetProven &&
        row.noContinuation &&
        row.snapshotUnchanged &&
        row.recovery.passed;
      const logs = t.backends.flatMap((id) =>
        t.lease
          .docker(['logs', id])
          .split('\n')
          .flatMap((l) => {
            try {
              return [JSON.parse(l)];
            } catch {
              return [];
            }
          }),
      );
      report.logGuardFailures.push(
        ...inspectPublishedLogs(logs, {
          markers: Object.values(t.lease.credentials).filter((v) => v !== 'fixture'),
        }),
      );
      row.logs = logs
        .filter((e) => (e.requestId || e.req?.id) === row.request?.xRequestId)
        .map((e) => ({
          requestId: e.requestId || e.req?.id,
          msg: e.msg,
          event: e.event,
          status: e.res?.statusCode,
          err: e.err ? { type: e.err.type, code: e.err.code } : undefined,
        }));
      fs.writeFileSync(directory + '/' + probe.name + '.json', JSON.stringify(row, null, 2));
      console.log(
        JSON.stringify({
          probe: probe.name,
          status: row.request?.status,
          durationMs: row.request?.durationMs,
          passed: row.passed,
          harnessError: row.harnessError,
          recovery: row.recovery.passed,
        }),
      );
      report.cleanupExitCode = await t.cleanup();
      t = undefined;
      if (
        report.cleanupExitCode ||
        !row.recovery.passed ||
        row.harnessError ||
        row.recoveryError ||
        row.fatal
      )
        throw Error('Harness/recovery/cleanup stop gate');
    }
  } catch (error) {
    report.failure = { type: error.name, message: error.message };
  } finally {
    if (t) {
      try {
        t.lease.mongoEval(
          t.mongo,
          "db.adminCommand({configureFailPoint:'failCommand',mode:'off'})",
        );
      } catch {
        report.failpointRecoveryFailed = true;
      }
      report.cleanupExitCode = await t.cleanup();
    }
    report.counts = {
      pass: report.probes.filter((p) => p.passed).length,
      fail: report.probes.filter((p) => !p.passed).length,
      skip: 0,
      notRun: probes.length - report.probes.length,
    };
    report.exitCode =
      report.failure ||
      report.cleanupExitCode ||
      report.failpointRecoveryFailed ||
      report.logGuardFailures.length ||
      report.counts.fail ||
      report.counts.notRun
        ? 1
        : 0;
    fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2));
    fs.writeFileSync(root + '/' + stage + '-latest.txt', directory);
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
