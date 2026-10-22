const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const { inspectPublishedLogs } = require('../roundA/disclosure-guard');
const stage = process.argv[2];
if (!['red', 'green'].includes(stage)) throw Error('Choose red or green');
const directory = 'artifacts/round-b/auth-csot/' + stage + '-' + randomUUID();
fs.mkdirSync(directory, { recursive: true });
const report = { stage, image: candidate.image.id, directory, rows: [], cleanupExitCode: null };
async function main() {
  let t;
  try {
    t = await topology('auth-csot-' + stage + '-' + randomUUID().slice(0, 8), {
      observerSource: 'tests/helpers/roundB/mongo-observer.js',
      failpoints: true,
    });
    report.run = t.lease.run;
    report.resources = t.lease.resources;
    t.lease.copyFile(
      'tests/helpers/roundB/auth-csot-client.js',
      t.client,
      '/fixture/auth-csot-client.js',
    );
    t.lease.docker(['exec', '-d', t.client, 'node', '/fixture/auth-csot-client.js']);
    const deadline = Date.now() + 360000;
    let previous = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      let data;
      try {
        data = JSON.parse(t.lease.exec(t.client, ['cat', '/fixture/auth-csot-result.json']));
      } catch {
        /* Not yet published. */
      }
      if (data?.rows) {
        report.rows = data.rows;
        if (report.rows.length !== previous) {
          previous = report.rows.length;
          console.log(JSON.stringify({ stage, collected: previous }));
        }
        fs.writeFileSync(directory + '/progress.json', JSON.stringify(report.rows, null, 2));
        if (report.rows.length === 12 && report.rows.at(-1).recovered) break;
      }
      try {
        const fatal = t.lease.exec(t.client, ['cat', '/fixture/auth-csot-fatal.json']);
        if (fatal)
          throw Object.assign(Error('Client harness failed'), { evidence: JSON.parse(fatal) });
      } catch (error) {
        if (error.evidence) throw error;
      }
    }
    if (report.rows.length !== 12 || !report.rows.at(-1).recovered)
      throw Error('Client evidence deadline');
    const observations = t.backends.flatMap((id, index) =>
      t.lease
        .exec(id, ['cat', '/fixture/mongo-observer.jsonl'])
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ index, ...JSON.parse(line) })),
    );
    fs.writeFileSync(directory + '/observer.json', JSON.stringify(observations, null, 2));
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
    for (const row of report.rows) {
      const related = observations.filter((e) => e.trace === row.trace);
      row.controllerEntered = related.some((e) => e.event === 'controller_enter');
      row.mongo = related;
      row.logs = logs
        .filter((e) => (e.requestId || e.req?.id) === row.requestId)
        .map((e) => ({
          requestId: e.requestId || e.req?.id,
          event: e.event,
          msg: e.msg,
          status: e.status || e.res?.statusCode,
          err: e.err ? { type: e.err.type, code: e.err.code } : undefined,
        }));
      if (row.controllerEntered)
        row.violations.push('controller entered after blocked middleware read');
      if (row.barrierAt == null || !row.recovered) row.violations.push('missing barrier/recovery');
      row.passed = row.violations.length === 0;
    }
    report.counts = {
      pass: report.rows.filter((r) => r.passed).length,
      fail: report.rows.filter((r) => !r.passed).length,
      skip: 0,
      notRun: 12 - report.rows.length,
    };
    report.exitCode = report.counts.fail || report.logGuardFailures.length ? 1 : 0;
  } catch (error) {
    report.exitCode = 1;
    report.harnessError = { type: error.name, reason: error.message, evidence: error.evidence };
  } finally {
    if (t) {
      if (!fs.existsSync(directory + '/observer.json')) {
        try {
          const observations = t.backends.flatMap((id, index) =>
            t.lease
              .exec(id, ['cat', '/fixture/mongo-observer.jsonl'])
              .split('\n')
              .filter(Boolean)
              .map((line) => ({ index, ...JSON.parse(line) })),
          );
          fs.writeFileSync(directory + '/observer.json', JSON.stringify(observations, null, 2));
          report.partialClient = JSON.parse(
            t.lease.exec(t.client, ['cat', '/fixture/auth-csot-result.json']),
          );
        } catch {
          report.partialEvidenceUnavailable = true;
        }
      }
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
    if (report.cleanupExitCode) report.exitCode = 1;
    fs.writeFileSync(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync('artifacts/round-b/auth-csot/' + stage + '-latest.txt', directory + '\n');
    console.log(
      JSON.stringify({
        directory,
        counts: report.counts,
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
        harnessError: report.harnessError,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
