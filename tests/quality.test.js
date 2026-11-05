const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
test('fingerprinting only normalizes CRLF, never spaces or code changes', () => {
  const { fingerprint } = require('../scripts/quality');
  expect(fingerprint('const value = 1;\r\n')).toBe(fingerprint('const value = 1;\n'));
  expect(fingerprint('const value = 1;\n') === fingerprint('const value = 2;\n')).toBe(false);
  expect(fingerprint('const value = 1;\n') === fingerprint('const value=1;\n')).toBe(false);
});
test.each(['true', 'false'])(
  'quality gate rejects a new untracked error independently of CI=%s',
  (ci) => {
    const file = path.resolve('scripts', `b05-quality-probe-${randomUUID()}.js`);
    fs.writeFileSync(file, 'untrackedB05Probe();\n', { flag: 'wx' });
    try {
      const result = spawnSync(process.execPath, ['scripts/quality.js'], {
        encoding: 'utf8',
        env: { ...process.env, CI: ci },
        timeout: 30000,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      const violation = report.violations.find(
        (item) => item.file === path.relative(process.cwd(), file).replaceAll('\\', '/'),
      );
      expect(violation?.rules.some((item) => item.rule === 'no-undef')).toBe(true);
    } finally {
      fs.unlinkSync(file);
    }
  },
);
