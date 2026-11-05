const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const { localRedisUrl } = require('./localRedisUrl');
const LABEL = 'totmart.test.run';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
});

// Only the returned object can operate this container. Never accept an ambient
// TEST_REDIS_CONTAINER/name as evidence of ownership.
async function disposableRedis({ database = 15, purpose = 'http', run = docker, onEvidence = () => {} } = {}) {
  localRedisUrl(`redis://127.0.0.1:1/${database}`);
  const owner = randomUUID();
  const name = `totmart-session-${owner}-${purpose}-redis`;
  // A fixed binding survives stop/start. If another process claims this port
  // before Docker, startup fails safely; never fall back to a shared endpoint.
  const port = await freePort();
  let id;
  const url = `redis://127.0.0.1:${port}/${database}`;
  const evidence = { owner, name, url, id: null, cleaned: false, tmpfs: true };
  function inspect(requireMapping = true) {
    const info = JSON.parse(run(['inspect', id]))[0];
    if (!/^[a-f0-9]{64}$/.test(id || '') || info.Id !== id || info.Config?.Labels?.[LABEL] !== owner || info.Name !== '/' + name) {
      throw new Error('Disposable Redis ownership mismatch; refusing Docker mutation');
    }
    if (requireMapping) {
      const parsed = localRedisUrl(url);
      const bindings = info.NetworkSettings?.Ports?.['6379/tcp'];
      if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || Number(bindings[0].HostPort) !== parsed.port) {
        throw new Error('Disposable Redis URL/port mapping mismatch; refusing Docker mutation');
      }
    }
    return info;
  }
  function action(operation) {
    if (!['stop', 'start', 'pause', 'unpause'].includes(operation)) throw new Error('Unsupported Redis drill action');
    // Docker clears active mappings on stop. Verify configured binding too.
    const info = inspect(false);
    const parsed = localRedisUrl(url);
    const bindings = info.HostConfig?.PortBindings?.['6379/tcp'];
    if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || Number(bindings[0].HostPort) !== parsed.port) {
      throw new Error('Disposable Redis configured URL mapping mismatch');
    }
    // Docker Desktop omits active Ports while paused (as well as stopped).
    // Verify the pinned configured mapping before recovery and active mapping
    // immediately afterwards; never infer a different URL from Docker state.
    if (info.State?.Running && !info.State?.Paused) inspect();
    run([operation, id]);
    if (operation === 'start' || operation === 'unpause') inspect();
  }
  function cleanup() {
    if (!id) return;
    const info = inspect(false);
    if (info.State?.Paused) action('unpause');
    run(['rm', '-f', id]); // No volumes; only the exact ID created here.
    id = undefined;
    evidence.cleaned = true; onEvidence({ ...evidence });
  }
  try {
    id = run(['create', '--name', name, '--label', `${LABEL}=${owner}`, '--publish', `127.0.0.1:${port}:6379`, '--tmpfs', '/data',
      'redis:7.4-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
    evidence.id = id; onEvidence({ ...evidence });
    inspect(false);
    action('start');
    const info = inspect(false);
    const bindings = info.NetworkSettings?.Ports?.['6379/tcp'];
    if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1') throw new Error('Redis must publish only on loopback');
    inspect();
    const deadline = Date.now() + 15000;
    while (true) {
      inspect();
      try { if (run(['exec', id, 'redis-cli', 'ping']) === 'PONG') break; } catch { /* bounded startup retry */ }
      if (Date.now() >= deadline) throw new Error('Disposable Redis readiness deadline');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { get url() { return url; }, action, cleanup };
  } catch (error) {
    // A Docker client timeout can happen after the daemon created the object.
    // Recover only our exact random name and label, never a name from env.
    if (!id) {
      try {
        const candidate = JSON.parse(run(['inspect', name]))[0];
        if (candidate.Config?.Labels?.[LABEL] === owner && candidate.Name === '/' + name && /^[a-f0-9]{64}$/.test(candidate.Id)) { id = candidate.Id; evidence.id = id; }
      } catch { /* no resource created */ }
    }
    try { cleanup(); } catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  }
}
module.exports = { disposableRedis };
