const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sourceHash = (bytes) =>
  crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
function evaluate(policy, summary, hashes) {
  const failures = [];
  for (const [file, baseline] of Object.entries(policy.files)) {
    const branch = summary[file]?.branches;
    if (hashes[file] !== baseline.sourceSha256)
      failures.push({ file, reason: 'source changed: explicit coverage review required' });
    if (!branch || branch.total !== baseline.branches.total || branch.skipped !== 0)
      failures.push({ file, reason: 'missing or incompatible branch instrumentation' });
    else if (branch.covered < baseline.branches.covered)
      failures.push({ file, reason: 'covered branches below reviewed baseline' });
  }
  return failures;
}
function checkCoverage(directory) {
  const policy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../tooling/commerce-coverage-baseline.json')),
  );
  const raw = JSON.parse(fs.readFileSync(path.join(directory, 'coverage-summary.json')));
  const summary = Object.fromEntries(
    Object.entries(raw).map(([file, value]) => [
      path.isAbsolute(file) ? path.relative(process.cwd(), file).replaceAll('\\', '/') : file,
      value,
    ]),
  );
  const hashes = Object.fromEntries(
    Object.keys(policy.files).map((file) => [file, sourceHash(fs.readFileSync(file))]),
  );
  const failures = evaluate(policy, summary, hashes);
  return { policy: policy.version, modules: Object.keys(policy.files).length, failures };
}
if (require.main === module) {
  try {
    const result = checkCoverage(process.argv[2]);
    console.log(JSON.stringify(result));
    if (result.failures.length) process.exitCode = 1;
  } catch {
    console.error('Commerce coverage gate failed: missing or invalid local evidence');
    process.exitCode = 1;
  }
}
module.exports = { checkCoverage, evaluate, sourceHash };
