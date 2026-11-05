const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { root, write } = require('./context');
const { sha } = require('./manifest');
const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
function ast(text) {
  return JSON.parse(
    JSON.stringify(require('@babel/parser').parse(text), (k, v) =>
      [
        'start',
        'end',
        'loc',
        'extra',
        'comments',
        'tokens',
        'leadingComments',
        'trailingComments',
        'innerComments',
      ].includes(k)
        ? undefined
        : v,
    ),
  );
}
(async () => {
  const files = [
    ...new Set([
      ...git(['diff', '--name-only']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ]),
  ].filter((f) => f.endsWith('.js') || f === 'docs/FE-BE-contract-handoff.md');
  const prettier = require('prettier'),
    report = [];
  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8'),
      logical = path.join(root, 'logical', file);
    fs.mkdirSync(path.dirname(logical), { recursive: true });
    let keep = false;
    if (fs.existsSync(logical) && file.endsWith('.js'))
      try {
        assert.deepStrictEqual(ast(fs.readFileSync(logical, 'utf8')), ast(before));
        keep = true;
      } catch {
        keep = false;
      }
    if (!keep) fs.writeFileSync(logical, before);
    const options = { ...(await prettier.resolveConfig(file)), filepath: file };
    let after = before;
    for (let i = 0; i < 3; i++) {
      const next = await prettier.format(after, options);
      if (next === after) break;
      after = next;
    }
    if (file.endsWith('.js')) assert.deepStrictEqual(ast(before), ast(after));
    assert(await prettier.check(after, options));
    fs.writeFileSync(file, after);
    report.push({
      file,
      before: sha(Buffer.from(before)),
      after: sha(Buffer.from(after)),
      astEqual: file.endsWith('.js') ? true : null,
    });
  }
  write('format-stage.json', report);
})().catch(() => {
  process.exitCode = 1;
});
