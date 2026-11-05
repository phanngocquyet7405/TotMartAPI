const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { sha } = require('./manifest');
function exportGroup(file) {
  assert(!/(^|\/)\.env(?:\.|$)/.test(file), 'Sensitive export refused');
  assert(
    /^(tests|docs)\//.test(file) ||
      [
        'jest.config.js',
        'scripts/verify-be-evidence.js',
        'src/controllers/notificationController.js',
      ].includes(file),
    'Unexpected behavior/source edit requires separate review',
  );
  return file === 'src/controllers/notificationController.js' ? 'behavior' : 'tooling';
}
function logicalText(file, beforeFormat, after) {
  if (!file.endsWith('.js')) return after;
  const ast = (text) =>
    JSON.stringify(require('@babel/parser').parse(text), (key, value) =>
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
      ].includes(key)
        ? undefined
        : value,
    );
  return ast(beforeFormat) === ast(after) ? beforeFormat : after;
}
function main() {
  const { root, write } = require('./context');
  const output = path.join(root, 'exports', require('node:crypto').randomUUID());
  fs.mkdirSync(output, { recursive: true });
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const files = [
    ...new Set(
      [
        ...git(['diff', 'HEAD', '--name-only']).split('\n'),
        ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
      ].filter(Boolean),
    ),
  ].sort();
  const groups = { behavior: [], tooling: [], format: [] },
    patches = { behavior: '', tooling: '', format: '' };
  const tmp = path.join(output, 'patch-input');
  fs.mkdirSync(tmp, { recursive: true });
  function diff(file, before, after, isNew = false, deleted = false) {
    const a = path.join(tmp, 'before.txt'),
      b = path.join(tmp, 'after.txt');
    fs.writeFileSync(a, before.replace(/\r\n/g, '\n'));
    fs.writeFileSync(b, after.replace(/\r\n/g, '\n'));
    let output;
    try {
      output = execFileSync('git', ['diff', '--no-index', '--no-color', '--', a, b], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      if (error.status !== 1) throw error;
      output = error.stdout.toString();
    }
    const index = output.search(/^@@/m);
    if (index < 0) return '';
    return (
      `diff --git a/${file} b/${file}\n${isNew ? 'new file mode 100644\n' : ''}${deleted ? 'deleted file mode 100644\n' : ''}--- ${isNew ? '/dev/null' : 'a/' + file}\n+++ ${deleted ? '/dev/null' : 'b/' + file}\n` +
      output.slice(index)
    );
  }
  for (const file of files) {
    const group = exportGroup(file);
    const deleted = !fs.existsSync(file);
    const after = deleted ? '' : fs.readFileSync(file, 'utf8');
    let before = '',
      isNew = false;
    try {
      before = execFileSync('git', ['show', 'HEAD:' + file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      isNew = true;
    }
    const logicalPath = path.join(root, 'logical', file),
      logical = fs.existsSync(logicalPath)
        ? logicalText(file, fs.readFileSync(logicalPath, 'utf8'), after)
        : after;
    patches[group] += diff(file, before, logical, isNew, deleted);
    patches.format += diff(file, logical, after);
    groups[group].push({
      file,
      new: isNew,
      deleted,
      beforeHeadBlobSha256: isNew ? null : sha(Buffer.from(before)),
      logicalSha256: sha(Buffer.from(logical)),
      afterSha256: deleted ? null : sha(fs.readFileSync(file)),
    });
    if (logical !== after) groups.format.push(file);
    for (const [stage, text] of [
      ['before', before],
      ['logical', logical],
      ['after', after],
    ]) {
      if (stage === 'before' && isNew) continue;
      if (deleted && stage === 'after') continue;
      const target = path.join(output, 'full-files', stage, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
  }
  for (const [name, content] of Object.entries(patches))
    fs.writeFileSync(path.join(output, name + '.patch'), content);
  const report = {
    groups,
    files: files.length,
    note: 'Owner-approved behavior patch is notificationController per-read CSOT only. Behavior/tooling HEAD→logical, format logical→final; full byte exports retained. Historical before is HEAD blob.',
  };
  fs.writeFileSync(path.join(output, 'patches.json'), JSON.stringify(report, null, 2) + '\n');
  write('export-current.json', {
    directory: output,
    manifestSha256: sha(fs.readFileSync(path.join(output, 'patches.json'))),
  });
  console.log(
    JSON.stringify({
      exitCode: 0,
      files: files.length,
      behavior: groups.behavior.length,
      tooling: groups.tooling.length,
      format: groups.format.length,
    }),
  );
}
if (require.main === module) main();
module.exports = { exportGroup, logicalText };
