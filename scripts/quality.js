const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ESLint } = require('eslint');
const prettier = require('prettier');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = (bytes) => sha(bytes.toString('utf8').replace(/\r\n/g, '\n'));
async function main() {
  const baseline = JSON.parse(fs.readFileSync('tooling/lint-baseline.json'));
  const eslint = new ESLint();
  const results = await eslint.lintFiles([
    'src/**/*.js',
    'scripts/**/*.js',
    'tests/**/*.js',
    '*.cjs',
    'jest.config.js',
  ]);
  const config = await eslint.calculateConfigForFile('src/server.js');
  if (
    baseline.eslint !== require('eslint/package.json').version ||
    baseline.policySha256 !==
      sha(JSON.stringify({ rules: config.rules, globals: config.languageOptions.globals }))
  )
    throw new Error('Lint policy/version changed: explicit baseline review required');
  const input = JSON.parse(fs.readFileSync('tooling/b05-input-lf-hashes.json'));
  const changed = results
    .map((result) => ({
      ...result,
      relative: path.relative(process.cwd(), result.filePath).replaceAll('\\', '/'),
    }))
    .filter(
      (result) =>
        baseline.files[result.relative]?.lfSha256 !== fingerprint(fs.readFileSync(result.filePath)),
    );
  if (process.argv[2] === 'format') {
    const additional = [
      'package.json',
      'package-lock.json',
      '.prettierrc.json',
      'docs/api.openapi.json',
      'docs/api-examples.json',
      'docs/B05-inventory.md',
      'docs/README.md',
      'tooling/commerce-coverage-baseline.json',
      'docs/B07-drill-matrix.md',
      'docs/B07-operations-runbook.md',
      'docs/B07-release-plan.md',
      'docs/FE-BE-contract-handoff.md',
    ];
    const files = [
      ...new Set([
        ...results.map((result) =>
          path.relative(process.cwd(), result.filePath).replaceAll('\\', '/'),
        ),
        ...additional,
      ]),
    ].filter((file) => fs.existsSync(file) && input[file] !== fingerprint(fs.readFileSync(file)));
    const invalid = [];
    for (const file of files)
      if (
        !(await prettier.check(fs.readFileSync(file, 'utf8'), {
          ...(await prettier.resolveConfig(file)),
          filepath: file,
        }))
      )
        invalid.push(file);
    console.log(JSON.stringify({ mode: 'format-check', checked: files.length, invalid }));
    if (invalid.length) process.exitCode = 1;
    return;
  }
  const violations = changed.filter((result) => result.errorCount || result.warningCount);
  console.log(
    JSON.stringify(
      {
        mode: 'lint-baseline',
        scanned: results.length,
        changed: changed.length,
        debtErrors: results.reduce((sum, result) => sum + result.errorCount, 0),
        violations: violations.map((result) => ({
          file: result.relative,
          rules: result.messages.map((message) => ({
            rule: message.ruleId,
            line: message.line,
            messageId: message.messageId,
          })),
        })),
      },
      null,
      2,
    ),
  );
  if (violations.length) process.exitCode = 1;
}
if (require.main === module)
  main().catch(() => {
    console.error('Quality configuration/check failed');
    process.exitCode = 1;
  });
module.exports = { fingerprint };
