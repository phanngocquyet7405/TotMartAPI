const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  canonicalTestFiles,
  assertCanonicalDiscovery,
  listTests,
} = require('./helpers/roundC2/jest-discovery');

const repo = path.resolve(__dirname, '..');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totmart-discovery-'));
  for (const file of [
    'tests/a.test.js',
    'tests/redisHttp.integration.test.js',
    'tests/nested/__tests__/deep/example.js',
    'artifacts/full-files/old.test.js',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'test("fixture", () => {});');
  }
});
afterEach(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('totmart-discovery-'))
    throw new Error('Fixture cleanup target mismatch');
  fs.rmSync(root, { recursive: true });
});
const config = () => ({ rootDir: root, roots: ['<rootDir>/tests'] });

test.each(['all', 'http'])('real repository --listTests matches %s selection', (mode) => {
  const actual = listTests(repo, mode);
  const result = assertCanonicalDiscovery(actual, { root: repo, mode });
  expect(result.suiteCount).toBe(mode === 'http' ? 1 : canonicalTestFiles(repo).length);
});

test.each(['all', 'http'])('independent fixture --listTests matches %s inventory', (mode) => {
  const actual = listTests(root, mode, config());
  expect(assertCanonicalDiscovery(actual, { root, mode }).suiteCount).toBe(mode === 'all' ? 3 : 1);
});

test('real discovery detects a config that leaks artifact copies', () => {
  const actual = listTests(root, 'all', { rootDir: root });
  expect(actual.some((file) => file.includes('artifacts'))).toBe(true);
  expect(() => assertCanonicalDiscovery(actual, { root })).toThrow('escaped');
});

test('real discovery detects a config that omits a canonical suite', () => {
  const actual = listTests(root, 'all', { ...config(), testPathIgnorePatterns: ['a.test.js'] });
  expect(() => assertCanonicalDiscovery(actual, { root })).toThrow('differs');
});

test.each(['artifacts', 'full-files', 'snapshot', 'snapshots'])(
  'refuses %s directories even below tests/',
  (directory) => {
    const file = `tests/${directory}/old.test.js`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '');
    expect(() => assertCanonicalDiscovery(canonicalTestFiles(root), { root })).toThrow('escaped');
  },
);

test.each(['missing', 'extra', 'duplicate', 'traversal', 'empty', 'invalid'])(
  'refuses %s suites in both modes',
  (kind) => {
    for (const mode of ['all', 'http']) {
      const actual =
        mode === 'all' ? canonicalTestFiles(root) : ['tests/redisHttp.integration.test.js'];
      if (kind === 'missing') actual.pop();
      if (kind === 'extra') actual.push('tests/unknown.test.js');
      if (kind === 'duplicate') actual.push(actual[0]);
      if (kind === 'traversal') actual.push('tests/../../outside.test.js');
      if (kind === 'empty') actual.length = 0;
      if (kind === 'invalid') actual.push(null);
      expect(() => assertCanonicalDiscovery(actual, { root, mode })).toThrow();
    }
  },
);

test('HTTP refuses the entire full inventory', () => {
  expect(() => assertCanonicalDiscovery(canonicalTestFiles(root), { root, mode: 'http' })).toThrow(
    'differs',
  );
});
