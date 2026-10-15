// One-shot probe for a deployment scheduler. No credentials are printed.
const base = process.env.MONITOR_API_URL;
if (!base || !/^https?:\/\//.test(base)) throw new Error('MONITOR_API_URL must be an absolute API URL');
async function run() {
  const results = [];
  for (const path of ['/home/live', '/home/health']) {
    try {
      const response = await fetch(base.replace(/\/$/, '') + path, { signal: AbortSignal.timeout(5000) });
      results.push({ path, ok: response.ok, status: response.status });
    } catch { results.push({ path, ok: false, error: 'timeout-or-network' }); }
  }
  console.log(JSON.stringify({ observedAt: new Date(), checks: results }));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
run().catch(() => { process.exitCode = 1; });
