const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep this selection in sync with run-be-tests; check actual runner results too.
const httpSuites = ['tests/redisHttp.integration.test.js'];

function canonicalTestFiles(root) {
  const testsRoot = path.resolve(root, 'tests');
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Jest discovery symlink refused');
      if (entry.isDirectory()) walk(absolute);
      else if (
        entry.isFile() &&
        (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ||
          (path.relative(testsRoot, absolute).split(path.sep).includes('__tests__') &&
            /\.[cm]?[jt]sx?$/.test(entry.name)))
      ) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }
  walk(testsRoot);
  return files.sort();
}

function assertCanonicalDiscovery(discovered, { root = process.cwd(), mode = 'all' } = {}) {
  if (!Array.isArray(discovered) || discovered.length === 0)
    throw new Error('Jest discovery evidence is empty');
  if (!['all', 'http'].includes(mode)) throw new Error('Unsupported discovery mode');
  const normalized = discovered.map((file) => {
    if (typeof file !== 'string' || !file) throw new Error('Invalid Jest suite path');
    return path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  });
  if (
    normalized.some(
      (file) =>
        !file.startsWith('tests/') ||
        /(^|\/)(?:artifacts|full-files|snapshot|snapshots)(\/|$)/i.test(file),
    )
  )
    throw new Error('Jest discovery escaped canonical tests/');
  const canonical = canonicalTestFiles(root);
  const expected = mode === 'all' ? canonical : httpSuites;
  if (expected.some((file) => !canonical.includes(file)))
    throw new Error('Selected Jest suite is missing from canonical inventory');
  const actual = [...normalized].sort();
  if (new Set(actual).size !== actual.length)
    throw new Error('Jest discovery contains duplicate suites');
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Jest discovery differs from canonical test files');
  return { suiteFiles: actual, suiteCount: actual.length };
}

function listTests(root, mode = 'all', config) {
  if (!['all', 'http'].includes(mode)) throw new Error('Unsupported discovery mode');
  const args = [require.resolve('jest/bin/jest'), '--listTests', '--json', '--runInBand'];
  if (config) args.push('--config', JSON.stringify(config));
  if (mode === 'http') args.push('--runTestsByPath', ...httpSuites);
  return JSON.parse(
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

module.exports = { canonicalTestFiles, assertCanonicalDiscovery, listTests };
