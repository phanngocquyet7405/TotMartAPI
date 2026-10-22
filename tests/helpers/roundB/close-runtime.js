const fs = require('node:fs');
const assert = require('node:assert/strict');
const { Lease, candidate } = require('./image-fixture');
const { evidence } = require('./close-context');
const { sourceManifest } = require('../../../scripts/evidence-manifest');
async function main() {
  const lease = new Lease('runtime');
  const report = { image: candidate.image.id, run: lease.run };
  try {
    lease.network();
    const id = lease.create(
      'runtime',
      candidate.image.id,
      [],
      [
        'node',
        '-e',
        "const fs=require('fs'),p=require('path'),c=require('crypto'),files={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.posix.join(d,e.name);if(e.isDirectory())walk(f);else files[f]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}}walk('src');walk('scripts');for(const f of ['package.json','package-lock.json'])files[f]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');console.log(JSON.stringify({files,node:process.version,uid:process.getuid()}))",
      ],
    );
    lease.start(id);
    await lease.poll(() => !lease.verify(id).state.Running, 10000, 'Runtime probe exit');
    report.probeExitCode = lease.verify(id).state.ExitCode;
    assert.equal(report.probeExitCode, 0);
    const runtime = JSON.parse(lease.docker(['logs', id]));
    const expected = Object.fromEntries(
      Object.entries(sourceManifest()).filter(
        ([file]) =>
          /^(src|scripts)\//.test(file) || ['package.json', 'package-lock.json'].includes(file),
      ),
    );
    Object.assign(report, {
      runtime,
      expected,
      differences: {
        missing: Object.keys(expected).filter((file) => !Object.hasOwn(runtime.files, file)),
        added: Object.keys(runtime.files).filter((file) => !Object.hasOwn(expected, file)),
        changed: Object.keys(expected).filter(
          (file) => Object.hasOwn(runtime.files, file) && runtime.files[file] !== expected[file],
        ),
      },
    });
    assert.deepStrictEqual(runtime.files, expected, 'Final image/runtime must match host source');
    assert.equal(runtime.node.split('.')[0], 'v24');
    assert.equal(runtime.uid, 1000);
    Object.assign(report, { passed: true, runtime, expected });
  } catch (error) {
    report.passed = false;
    report.failureType = error.name;
  } finally {
    report.cleanupExitCode = await lease.cleanup();
    report.exitCode = report.passed && report.cleanupExitCode === 0 ? 0 : 1;
    fs.writeFileSync(evidence('runtime.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        passed: report.passed,
        cleanupExitCode: report.cleanupExitCode,
        exitCode: report.exitCode,
      }),
    );
    process.exitCode = report.exitCode;
  }
}
main();
