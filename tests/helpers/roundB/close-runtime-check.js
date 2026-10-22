const fs = require('node:fs');
const assert = require('node:assert/strict');
const { sourceManifest } = require('../../../scripts/evidence-manifest');
const { evidence } = require('./close-context');
function check(lease, id) {
  const actual = JSON.parse(
    lease.exec(id, [
      'node',
      '-e',
      "const fs=require('fs'),p=require('path'),c=require('crypto'),files={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.posix.join(d,e.name);if(e.isDirectory())walk(f);else files[f]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}}walk('src');walk('scripts');for(const f of ['package.json','package-lock.json'])files[f]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');console.log(JSON.stringify(files))",
    ]),
  );
  const expected = Object.fromEntries(
    Object.entries(sourceManifest()).filter(
      ([file]) =>
        /^(src|scripts)\//.test(file) || ['package.json', 'package-lock.json'].includes(file),
    ),
  );
  assert.deepStrictEqual(actual, expected, 'Image/runtime source differs from host');
  const result = {
    id,
    run: lease.run,
    image: lease.verify(id).image,
    matched: true,
    files: actual,
  };
  fs.appendFileSync(evidence('runtime-checks.jsonl'), JSON.stringify(result) + '\n');
  return result;
}
module.exports = { check };
