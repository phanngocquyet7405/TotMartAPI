// Synthetic, local CPU benchmark only. Never accepts or prints real credentials/hashes.
const bcrypt = require('bcrypt');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
async function main() {
  const password = randomBytes(24).toString('hex');
  const results = [];
  for (const cost of [9, 10, 11, 12, 13]) {
    await bcrypt.hash(password, cost);
    const wall = [], cpuStart = process.cpuUsage();
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await bcrypt.hash(password, cost);
      wall.push(performance.now() - start);
    }
    const cpu = process.cpuUsage(cpuStart);
    wall.sort((a,b) => a-b);
    results.push({ cost, samples: wall.length, medianMs: +wall[2].toFixed(2), maxMs: +wall[4].toFixed(2), cpuMs: +(cpu.user/1000+cpu.system/1000).toFixed(2) });
  }
  const hash = await bcrypt.hash(password, 12);
  const cpuStart = process.cpuUsage(), start = performance.now();
  await Promise.all(Array.from({ length: 4 }, () => bcrypt.compare(password, hash)));
  return { kind: 'synthetic-local-not-production', node: process.version, platform: process.platform,
    cpuModel: os.cpus()[0].model, logicalCpus: os.cpus().length, uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || 'default', results,
    parallelCompare: { cost: 12, concurrency: 4, wallMs: +(performance.now()-start).toFixed(2), cpuMs: +(Object.values(process.cpuUsage(cpuStart)).reduce((a,b)=>a+b,0)/1000).toFixed(2) } };
}
module.exports = { main };
if (require.main === module) main().then(result=>console.log(JSON.stringify(result,null,2))).catch(() => { console.error('Synthetic benchmark failed'); process.exitCode = 1; });
