const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const directories = ['src', 'tests', 'scripts', 'tooling', '.github'];
const fixedFiles = [
  'package.json',
  'package-lock.json',
  'jest.config.js',
  'eslint.config.cjs',
  '.prettierrc.json',
  'Dockerfile',
  'docs/api.openapi.json',
  'docs/api-examples.json',
  'docs/B05-inventory.md',
  'docs/README.md',
  'docs/B06-invariants.md',
  'docs/B07-drill-matrix.md',
  'docs/B07-operations-runbook.md',
  'docs/B07-release-plan.md',
  'docs/checkout-attempt-contract.md',
  'docs/UNIFIED-COMMERCE-CONTRACT.md',
  'docs/MANAGER-API-CONTRACT.md',
  'docs/MERCHANT-OPERATING-MODEL.md',
  'docs/refresh-family-policy.md',
  'OPERATIONS.md',
  'docs/FE-BE-contract-handoff.md',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function sourceManifest(root = process.cwd(), dirs = directories, fixed = fixedFiles) {
  const files = {};
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files[file] = sha256(fs.readFileSync(path.join(root, file)));
      else throw new Error('Unsupported source entry');
    }
  }
  dirs.forEach(walk);
  for (const file of fixed) files[file] = sha256(fs.readFileSync(path.join(root, file)));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
function compareManifest(expected, actual) {
  return {
    added: Object.keys(actual).filter((file) => !(file in expected)),
    missing: Object.keys(expected).filter((file) => !(file in actual)),
    changed: Object.keys(expected).filter(
      (file) => file in actual && actual[file] !== expected[file],
    ),
  };
}
module.exports = { sourceManifest, compareManifest, sha256 };
