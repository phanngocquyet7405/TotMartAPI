const fs = require('node:fs');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const topology = require('./topology');
const { candidate } = require('./image-fixture');
const context = require('./close-context');
const entry = JSON.parse(
  fs.readFileSync(
    context.directory() ? context.evidence('entry.json') : 'artifacts/round-b/entry-current.json',
  ),
);
const output = context.evidence('phase5.json');
const report = {
  phase: 5,
  head: entry.head,
  engine: entry.engine,
  candidateImage: candidate.image.id,
  imageReusedFromA: !context.directory(),
  cases: [],
  plannedCases: 12,
  skipped: 0,
  browserE2E: false,
};
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
async function main() {
  let t;
  try {
    const manifest = sourceManifest();
    report.sourceManifestSha256 = sha256(JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(
      context.evidence('phase5-source-sha256.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    t = await topology('phase5');
    report.run = t.lease.run;
    const runtime = JSON.parse(
      t.lease.exec(t.client, [
        'node',
        '-e',
        "const fs=require('fs'),p=require('path'),c=require('crypto'),files={};function walk(d){for(const e of fs.readdirSync('/app/'+d,{withFileTypes:true})){const f=p.posix.join(d,e.name);if(e.isDirectory())walk(f);else files[f]=c.createHash('sha256').update(fs.readFileSync('/app/'+f)).digest('hex')}}walk('src');walk('scripts');console.log(JSON.stringify(files))",
      ]),
    );
    const expected = Object.fromEntries(
      Object.entries(manifest).filter(([file]) => /^(src|scripts)\//.test(file)),
    );
    if (
      JSON.stringify(Object.entries(runtime).sort()) !==
      JSON.stringify(Object.entries(expected).sort())
    )
      throw Error('Image/runtime tree mismatch');
    report.runtimeTreeMatches = true;
    async function runCase(command, timeout = 60000) {
      const result = t.run(command, timeout);
      if (result.cases)
        report.cases.push(
          ...result.cases.map((test) => ({
            ...test,
            source: 'B06 unchanged assertion body',
            requests: result.requests,
          })),
        );
      else {
        if (result.completedCases)
          report.cases.push(
            ...result.completedCases.map((test) => ({
              ...test,
              source: 'B06 unchanged assertion body',
            })),
          );
        report.cases.push({
          ...result,
          name: result.failedCase || command,
          errorType: result.name,
        });
      }
      save();
      console.log(JSON.stringify({ command, passed: result.passed, cases: report.cases.length }));
      if (!result.passed) {
        if (!result.cases) report.failureEvidence = result;
        const error = Error(`Phase 5 scenario failed: ${result.failedCase || command}`);
        error.classification =
          result.name === 'AssertionError'
            ? 'application assertion or adapter mismatch: investigate before any fix'
            : 'unclassified';
        throw error;
      }
    }
    await runCase('b06', 180000);
    await runCase('auth-cookie-db');
    await runCase('family-budget');
    await runCase('history-boundary');
    await runCase('attempt-contract');
    await runCase('sse-families', 80000);
    await runCase('recovery-arm');
    t.lease.verify(t.backends[0]);
    t.lease.docker(['kill', '--signal', 'SIGKILL', t.backends[0]]);
    t.lease.start(t.backends[0]);
    await t.lease.poll(() => t.lease.health(t.backends[0]), 30000, 'Restarted backend readiness');
    await runCase('recovery-check');
    report.exitCode = 0;
  } catch (error) {
    report.exitCode = 1;
    report.failure = error.message;
    report.failureClassification = error.classification || 'unclassified setup/harness/environment';
    if (error.cleanupExitCode !== undefined) report.cleanupExitCode = error.cleanupExitCode;
    process.exitCode = 1;
  } finally {
    if (t) report.cleanupExitCode = await t.cleanup();
    if (report.cleanupExitCode) process.exitCode = 1;
    report.counts = {
      passed: report.cases.filter((test) => test.passed).length,
      failed: report.cases.filter((test) => !test.passed).length,
      skipped: 0,
    };
    report.notRun = Math.max(0, report.plannedCases - report.cases.length);
    save();
    console.log(
      JSON.stringify({
        exitCode: report.exitCode,
        cleanupExitCode: report.cleanupExitCode,
        counts: report.counts,
        notRun: report.notRun,
        failure: report.failure,
      }),
    );
  }
}
main().catch(() => {
  console.error('Phase 5 outer harness failed');
  process.exitCode = 1;
});
