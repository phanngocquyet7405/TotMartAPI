// A2-0 specification only: existing candidate, two real backends, independent Mongo observer.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a2-0/current.json')).directory;
const directory = root + '/commits-' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
const report = {
  directory,
  image: candidate.image.id,
  cases: [],
  cleanupExitCode: 0,
  resources: [],
  logGuardFailures: [],
};
const modes = ['server-unknown-applied', 'lost-ack-after-commit'];
const only = process.argv.indexOf('--only');
const selected = only < 0 ? modes : [process.argv[only + 1]];
assert(selected.every((mode) => modes.includes(mode)));
const observerSource = directory + '/observer.js.txt';
fs.writeFileSync(
  observerSource,
  fs.readFileSync('tests/helpers/roundB/mongo-observer.js', 'utf8') +
    '\n' +
    fs.readFileSync('tests/helpers/roundB/a2-commit-observer.js', 'utf8'),
);
function parse(output, prefix) {
  const line = output.split('\n').findLast((value) => value.startsWith(prefix));
  if (!line) throw Error('Harness sanitized result absent');
  return JSON.parse(line.slice(prefix.length));
}
async function main() {
  let t;
  try {
    const entry = JSON.parse(fs.readFileSync(root + '/entry.json'));
    const current = sourceManifest();
    for (const [file, hash] of Object.entries(entry.source).filter(([file]) =>
      file.startsWith('src/'),
    ))
      assert.equal(current[file], hash, 'A2-0 prohibits BE source changes: ' + file);
    report.runtimeSource = Object.fromEntries(
      Object.entries(current).filter(
        ([file]) => file.startsWith('src/') || ['package.json', 'package-lock.json'].includes(file),
      ),
    );
    for (const mode of selected) {
      console.log(JSON.stringify({ mode, stage: 'setup' }));
      t = await topology('a2-' + mode + '-' + randomUUID().slice(0, 8), {
        observerSource,
        failpoints: true,
        mongoAckProxy: true,
      });
      report.resources.push(...t.lease.resources);
      const runtime = JSON.parse(
        t.lease.exec(t.backends[0], [
          'node',
          '-e',
          "const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[1]).map(f=>[f,c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))))",
          JSON.stringify(Object.keys(report.runtimeSource)),
        ]),
      );
      assert.deepStrictEqual(
        runtime,
        report.runtimeSource,
        'Candidate runtime must match current source',
      );
      for (const file of ['mongo-evidence-client', 'a2-commit-client'])
        t.lease.copyFile(
          'tests/helpers/roundB/' + file + '.js',
          t.client,
          '/fixture/' + file + '.js',
        );
      const setup = parse(
        t.lease.exec(t.client, ['node', '/fixture/mongo-evidence-client.js', 'setup'], 90000),
        'MONGO_EVIDENCE_RESULT=',
      );
      assert(setup.passed, 'Disposable fixture setup');
      const faultTargets = {
        mongo: t.lease.verify(t.mongo).id,
        proxy: t.lease.verify(t.ackProxy).id,
        production: t.lease.verify(t.backends[0]).id,
        owner: t.lease.run,
        processId: t.lease.mongoEval(
          t.mongo,
          'print(db.hello().topologyVersion.processId.toHexString())',
        ),
      };
      const row = parse(
        t.lease.exec(t.client, ['node', '/fixture/a2-commit-client.js', mode], 150000),
        'A2_RESULT=',
      );
      report.cases.push(row);
      row.run = t.lease.run;
      row.faultTargets = faultTargets;
      assert.equal(
        row.mongoProcessId,
        faultTargets.processId,
        'Independent observer must use the exact owned Mongo process',
      );
      row.before = setup.snapshot;
      row.commits = t.lease
        .exec(t.backends[0], ['cat', '/fixture/a2-commits.jsonl'])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const target = row.proxy?.events.find((event) => event.event === 'commit_forwarded');
      const commits = row.commits.filter(
        (event) => event.transactionHash === target?.transactionHash,
      );
      row.sameTransactionCommitRetries = commits.filter(
        (event) => event.event === 'commit_started',
      ).length;
      row.specificationPassed = row.passed;
      row.retryProven = row.sameTransactionCommitRetries >= 2;
      row.unknownLabelObserved = commits.some((event) =>
        event.errorLabels?.includes('UnknownTransactionCommitResult'),
      );
      row.networkFailureObserved = commits.some(
        (event) => event.event === 'commandFailed' && /Network/.test(event.errorType),
      );
      row.passed =
        row.passed &&
        row.retryProven &&
        (mode === 'server-unknown-applied' ? row.unknownLabelObserved : row.networkFailureObserved);
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
          markers: Object.values(t.lease.credentials).filter((value) => value !== 'fixture'),
        }),
      );
      row.cleanupExitCode = await t.cleanup();
      t = undefined;
      report.cleanupExitCode ||= row.cleanupExitCode;
      fs.writeFileSync(directory + '/' + mode + '.json', JSON.stringify(row, null, 2));
      console.log(
        JSON.stringify({
          mode,
          passed: row.passed,
          p0: row.p0,
          stage: row.stage,
          retryProven: row.retryProven,
          unknownLabelObserved: row.unknownLabelObserved,
          networkFailureObserved: row.networkFailureObserved,
          cleanupExitCode: row.cleanupExitCode,
        }),
      );
      if (row.p0 || !row.passed || row.cleanupExitCode || row.faultRecoveryFailed)
        throw Error('A2-0 stop gate');
    }
  } catch (error) {
    report.cleanupExitCode ||= error.cleanupExitCode || 0;
    report.failure = {
      type: error.name,
      message: error.message,
      classification: 'undetermined pending evidence review',
    };
  } finally {
    if (t) {
      const cleanupCode = await t.cleanup();
      report.cleanupExitCode ||= cleanupCode;
    }
    report.counts = {
      pass: report.cases.filter((row) => row.passed).length,
      fail: report.cases.filter((row) => !row.passed).length,
      skip: 0,
      notRun: selected.length - report.cases.length,
    };
    report.exitCode =
      report.failure ||
      report.cleanupExitCode ||
      report.logGuardFailures.length ||
      report.counts.fail ||
      report.counts.notRun
        ? 1
        : 0;
    report.protectedHashes = Object.fromEntries(
      Object.keys(JSON.parse(fs.readFileSync(root + '/entry.json')).protectedHashes).map((file) => [
        file,
        sha256(fs.readFileSync(file)),
      ]),
    );
    fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2));
    fs.writeFileSync(root + '/commits-latest.txt', directory);
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
