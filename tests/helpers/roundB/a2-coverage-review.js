// Produce explicit old/current instrumentation evidence before any policy edit.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { sourceHash } = require('../../../scripts/check-commerce-coverage');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a2-0/current.json')).directory;
const policy = JSON.parse(fs.readFileSync('tooling/commerce-coverage-baseline.json'));
const rows = [];
for (const [file, baseline] of Object.entries(policy.files)) {
  const current = fs.readFileSync(file, 'utf8');
  if (sourceHash(Buffer.from(current)) === baseline.sourceSha256) continue;
  const previous = execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' });
  if (sourceHash(Buffer.from(previous)) !== baseline.sourceSha256)
    throw Error('Reviewed old source is not HEAD: ' + file);
  const instrument = (source) => {
    const tool = createInstrumenter();
    tool.instrumentSync(source, file);
    const coverage = tool.lastFileCoverage();
    const lines = source.split('\n');
    return {
      total: Object.values(coverage.b).reduce((n, branches) => n + branches.length, 0),
      branches: Object.values(coverage.branchMap).map((branch) => ({
        type: branch.type,
        locations: branch.locations,
        source: lines.slice(branch.loc.start.line - 1, branch.loc.end.line).join('\n'),
      })),
    };
  };
  rows.push({
    file,
    beforeHash: baseline.sourceSha256,
    afterHash: sourceHash(Buffer.from(current)),
    baseline: baseline.branches,
    before: instrument(previous),
    after: instrument(current),
  });
}
fs.writeFileSync(root + '/coverage-instrumentation-review.json', JSON.stringify(rows, null, 2));
console.log(
  JSON.stringify(
    rows.map(({ file, before, after, baseline, afterHash }) => ({
      file,
      beforeTotal: before.total,
      afterTotal: after.total,
      baseline,
      afterHash,
    })),
  ),
);
