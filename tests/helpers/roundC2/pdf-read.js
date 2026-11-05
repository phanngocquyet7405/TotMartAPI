const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { root, write } = require('./context');
const { sha } = require('./manifest');
const source = 'C:/Users/84862/Desktop/as/TotMart_Lo_trinh_85_BE_FE_va_nghiem_thu_staging.pdf';
const base = path.resolve('artifacts/c2-tool-deps'),
  target = path.join(base, path.basename(root));
assert(path.dirname(target) === base && !fs.existsSync(target));
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'c2-owner.json'), JSON.stringify({ root }));
let exitCode = 1;
try {
  const installed = spawnSync(
    'py',
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', target, 'pymupdf'],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
  );
  write('pdf-install.json', {
    exitCode: installed.status,
    outputBytes: Buffer.byteLength((installed.stdout || '') + (installed.stderr || '')),
  });
  assert.equal(installed.status, 0);
  const result = spawnSync('py', ['tests/helpers/roundC2/pdf-read.py', target, source, root], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  });
  assert.equal(result.status, 0);
  exitCode = 0;
  write('pdf-source.json', {
    path: source,
    sha256: sha(fs.readFileSync(source)),
    bytes: fs.statSync(source).size,
    exitCode,
  });
} finally {
  assert(
    path.dirname(target) === base &&
      JSON.parse(fs.readFileSync(path.join(target, 'c2-owner.json'))).root === root,
  );
  fs.rmSync(target, { recursive: true });
  write('pdf-tool-cleanup.json', { target, absent: !fs.existsSync(target) });
  process.exitCode = exitCode;
}
