// Diagnostic only: never adds query/session/transaction deadlines to the application.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const directory = 'artifacts/round-b/auth-csot/after-auth-' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
const report = {
  directory,
  image: candidate.image.id,
  probes: [],
  classification: 'measurement-only',
  blockTimeMS: 20000,
  clientDeadlineMs: 45000,
  limitations: [
    'blockConnection before execution is not lost Mongo commit ACK or UnknownTransactionCommitResult',
    '20s injected delay measures response, not a worst-case upper bound',
    'COD product fixture; optional coupon/box branches not exercised',
  ],
};
let probes = [
  {
    name: 'replay-before-transaction',
    collection: 'checkouts',
    source: 'checkoutLifecycle.replay',
    transaction: false,
  },
  {
    name: 'prepare-attempt-before-transaction',
    collection: 'checkoutattempts',
    source: 'checkoutAttemptService.prepare/Attempt.findOne',
    transaction: false,
  },
  {
    name: 'prepare-address-before-transaction',
    collection: 'users',
    skip: 1,
    source: 'checkoutAttemptService.prepare/User.findById',
    transaction: false,
  },
  {
    name: 'prepare-attempt-in-transaction',
    collection: 'checkoutattempts',
    skip: 1,
    source: 'checkoutAttemptService.prepare/transaction/Attempt.findOne',
    transaction: true,
  },
  {
    name: 'prepare-commit',
    command: 'commitTransaction',
    source: 'connection.transaction/withTransaction/commitTransaction',
    transaction: true,
  },
  {
    name: 'commerce-replay-in-transaction',
    collection: 'checkouts',
    skip: 1,
    source: 'checkOutController.withTransaction/replay',
    transaction: true,
  },
  {
    name: 'commerce-user-in-transaction',
    collection: 'users',
    skip: 2,
    source: 'checkOutController.withTransaction/User.findById',
    transaction: true,
  },
  {
    name: 'commerce-cart-in-transaction',
    collection: 'carts',
    source: 'checkOutController.withTransaction/Cart.findOne',
    transaction: true,
  },
  {
    name: 'policy-products-in-transaction',
    collection: 'products',
    source: 'pricingService.buildQuote/Product.find',
    transaction: true,
  },
  {
    name: 'policy-brand-populate-in-transaction',
    collection: 'brands',
    source: 'pricingService.buildQuote/Product.populate(brand)',
    transaction: true,
  },
  {
    name: 'commerce-commit',
    command: 'commitTransaction',
    skip: 1,
    source: 'checkOutController.withTransaction/commitTransaction',
    transaction: true,
  },
];
const onlyIndex = process.argv.indexOf('--only');
const correction = onlyIndex !== -1;
if (correction) {
  const names = process.argv[onlyIndex + 1].split(',');
  const selected = probes.filter((probe) => names.includes(probe.name));
  if (selected.length !== names.length) throw Error('Unknown probe selection');
  probes = selected;
}
report.plannedProbes = probes.map((probe) => probe.name);
async function main() {
  let t;
  try {
    report.resources = [];
    report.logGuardFailures = [];
    report.cleanupExitCode = 0;
    const invoke = (mode) => {
      const output = t.lease.exec(
        t.client,
        ['node', '/fixture/mongo-evidence-client.js', mode],
        90000,
      );
      return JSON.parse(
        output
          .split('\n')
          .findLast((line) => line.startsWith('MONGO_EVIDENCE_RESULT='))
          .slice('MONGO_EVIDENCE_RESULT='.length),
      );
    };
    for (const probe of probes) {
      console.log(JSON.stringify({ probe: probe.name, stage: 'before' }));
      // Fresh topology/Redis namespace per probe keeps the real limiter policy intact.
      t = await topology('checkout-waits-' + randomUUID().slice(0, 8), {
        observerSource: 'tests/helpers/roundB/mongo-observer.js',
        failpoints: true,
      });
      report.resources.push(...t.lease.resources);
      for (const file of ['mongo-evidence-client', 'checkout-wait-client'])
        t.lease.copyFile(
          'tests/helpers/roundB/' + file + '.js',
          t.client,
          '/fixture/' + file + '.js',
        );
      const before = invoke('setup');
      if (!before.passed) throw Error('Owned probe setup failed');
      const output = t.lease.exec(
        t.client,
        ['node', '/fixture/checkout-wait-client.js', JSON.stringify(probe)],
        75000,
      );
      const row = JSON.parse(
        output
          .split('\n')
          .findLast((line) => line.startsWith('CHECKOUT_WAIT_RESULT='))
          .slice('CHECKOUT_WAIT_RESULT='.length),
      );
      row.before = before.snapshot;
      row.run = t.lease.run;
      report.probes.push(row);
      if (row.invariantFailure) {
        report.stopReason = 'P0/P1 invariant';
        throw Error('Invariant stop gate');
      }
      if (!row.passedMeasurement || !row.pingRecovered)
        throw Error('Probe harness/recovery failed');
      row.replayRecovery = invoke('recover');
      if (row.replayRecovery.invariantFailure) {
        report.stopReason = 'P0/P1 replay invariant';
        throw Error('Invariant stop gate');
      }
      if (!row.replayRecovery.passed) throw Error('Replay recovery failed');
      const observations = JSON.parse(
        '[' +
          t.lease
            .exec(t.backends[0], ['cat', '/fixture/mongo-observer.jsonl'])
            .trim()
            .split('\n')
            .join(',') +
          ']',
      );
      row.mongo = observations.filter((e) => e.trace === row.request.trace);
      const starts = row.mongo.filter(
        (e) =>
          e.event === 'command_start' &&
          e.command === (probe.command || 'find') &&
          (!probe.collection || e.collection === probe.collection),
      );
      const target = starts[probe.skip || 0];
      const end = row.mongo.find(
        (e) => e.wireId === target?.wireId && e.event === 'commandSucceeded',
      );
      row.targetObserved =
        !!target && !!end && end.durationMs >= 19000 && target.transaction === probe.transaction;
      row.blockedWire = { start: target, end };
      row.blockedCommandCount = row.mongo.filter(
        (event) => event.event === 'commandSucceeded' && event.durationMs >= 19000,
      ).length;
      if (row.blockedCommandCount !== 1)
        throw Error('Harness blocked more than the selected command');
      if (!row.targetObserved) throw Error('Target command/duration/transaction evidence mismatch');
      row.authReads = row.mongo.filter((e) => e.event === 'query_start').slice(0, 2);
      row.authPassedBeforeFault =
        row.authReads.length === 2 &&
        row.authReads[0].model === 'User' &&
        row.authReads[1].model === 'AuthSession' &&
        row.authReads.every(
          (query) =>
            query.timeoutMS === 5000 &&
            row.mongo.some(
              (event) =>
                event.event === 'query_end' &&
                event.queryId === query.queryId &&
                event.outcome === 'success' &&
                event.at <= target.at,
            ),
        );
      if (!row.authPassedBeforeFault)
        throw Error('Auth completion before injected command not proven');
      fs.writeFileSync(directory + '/' + probe.name + '.json', JSON.stringify(row, null, 2));
      console.log(
        JSON.stringify({
          probe: probe.name,
          status: row.status,
          durationMs: row.durationMs,
          targetObserved: row.targetObserved,
          replayPassed: row.replayRecovery.passed,
        }),
      );
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
      report.logGuardFailures.push(
        ...inspectPublishedLogs(logs, {
          markers: Object.values(t.lease.credentials).filter((v) => v !== 'fixture'),
        }),
      );
      row.logs = logs
        .filter((e) => (e.requestId || e.req?.id) === row.request.xRequestId)
        .map((e) => ({
          requestId: e.requestId || e.req?.id,
          event: e.event,
          status: e.status || e.res?.statusCode,
          msg: e.msg,
          err: e.err ? { type: e.err.type, code: e.err.code } : undefined,
        }));
      row.cleanupExitCode = await t.cleanup();
      if (row.cleanupExitCode) {
        report.cleanupExitCode = row.cleanupExitCode;
        throw Error('Cleanup stop gate');
      }
      t = undefined;
      fs.writeFileSync(directory + '/' + probe.name + '.json', JSON.stringify(row, null, 2));
    }
    report.exitCode = report.logGuardFailures.length ? 1 : 0;
  } catch (error) {
    report.exitCode = 1;
    report.failure = error.message;
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
    if (report.cleanupExitCode || report.failpointRecoveryFailed) report.exitCode = 1;
    report.counts = {
      measured: report.probes.filter((p) => p.targetObserved).length,
      notRun: probes.length - report.probes.length,
    };
    fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2));
    fs.writeFileSync(
      'artifacts/round-b/auth-csot/' +
        (correction ? 'after-auth-correction' : 'after-auth') +
        '-latest.txt',
      directory,
    );
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
