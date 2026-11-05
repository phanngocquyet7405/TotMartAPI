const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { root, write, sha } = require('./context');
const files = [
  'scripts/migrate-commerce-integrity.js',
  'tests/commerceMigrationC1.integration.test.js',
  'tests/attemptRecovery.integration.test.js',
  'tests/operationsB07.integration.test.js',
  ...['context', 'run', 'migration-crash', 'identity', 'ops', 'watchdog', 'quality', 'finish'].map(
    (f) => 'tests/helpers/roundC1/' + f + '.js',
  ),
].filter((f) => fs.existsSync(f));
function ast(source) {
  return JSON.parse(
    JSON.stringify(require('@babel/parser').parse(source), (k, v) =>
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
  if (process.argv.includes('--format')) {
    const prettier = require('prettier'),
      rows = [];
    const formatRun = require('node:crypto').randomUUID();
    for (const file of files) {
      const before = fs.readFileSync(file, 'utf8'),
        target = path.join(root, 'format-passes', formatRun, 'before', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, before);
      const options = { ...(await prettier.resolveConfig(file)), filepath: file };
      let after = before;
      for (let i = 0; i < 3; i++) {
        const next = await prettier.format(after, options);
        if (next === after) break;
        after = next;
      }
      assert.deepEqual(ast(after), ast(before));
      assert(await prettier.check(after, options));
      fs.writeFileSync(file, after);
      const afterFile = path.join(root, 'format-passes', formatRun, 'after', file);
      fs.mkdirSync(path.dirname(afterFile), { recursive: true });
      fs.writeFileSync(afterFile, after);
      rows.push({
        file,
        before: sha(Buffer.from(before)),
        after: sha(Buffer.from(after)),
        astEqual: true,
        beforeFile: path.relative(root, target),
        afterFile: path.relative(root, afterFile),
      });
    }
    write('format-ast.json', rows);
    return;
  }
  const results = [];
  for (const [name, args] of [
    ['lint', ['scripts/quality.js']],
    ['format', ['scripts/quality.js', 'format']],
    ['api', ['scripts/validate-api.js']],
  ]) {
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    results.push({
      name,
      exitCode: result.status,
      spawnError: result.error?.code,
      output: result.stdout?.trim() || '',
    });
  }
  write('quality.json', results);
  console.log(JSON.stringify(results));
  if (results.some((r) => r.exitCode !== 0)) process.exitCode = 1;
})().catch(() => {
  process.exitCode = 1;
});
