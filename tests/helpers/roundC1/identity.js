require('../noDotenv');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const { mongo, write, docker, run } = require('./context');
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
  JWT_EXPIRES_IN: '1h',
  JWT_REFRESH_EXPIRES_IN: '1d',
  SEPAY_API_KEY: randomBytes(24).toString('hex'),
  SEPAY_BANK_ACCOUNT: '0123456789',
  SEPAY_BANK_NAME: 'FixtureBank',
  FRONTEND_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:3001',
  TRUST_PROXY: '0',
  BCRYPT_COST: '12',
  REDIS_URL: '',
});
const app = require('../../../src/app');
const User = require('../../../src/models/User');
const identity = require('../../../src/services/userIdentityService');
const { AUTH_READ_TIMEOUT_MS } = require('../../../src/config/authReadPolicy');
const quantiles = (rows) => {
  const values = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    samples: values.length,
    p50Ms: values[Math.ceil(values.length * 0.5) - 1],
    p95Ms: values[Math.ceil(values.length * 0.95) - 1],
    minMs: values[0],
    maxMs: values.at(-1),
    timeoutCount: rows.filter((r) => r.timeout).length,
    timeoutRatio: rows.filter((r) => r.timeout).length / rows.length,
  };
};
(async () => {
  let fixture, server, sampler;
  const stats = [];
  try {
    fixture = await mongo('identity');
    await fixture.assertTarget();
    await mongoose.connect(fixture.uri(fixture.database), { monitorCommands: true });
    await User.createIndexes();
    const password = 'Synthetic-C1-Password!';
    const hash = await require('bcrypt').hash(password, 12);
    const size = 200000,
      seedStart = Date.now();
    for (let start = 0; start < size; start += 5000) {
      await User.collection.insertMany(
        Array.from({ length: Math.min(5000, size - start) }, (_, offset) => {
          const i = start + offset;
          return {
            name: 'Synthetic repeated display',
            email:
              i === size - 2
                ? 'Collision@Example.com'
                : i === size - 1
                  ? ' collision@example.com '
                  : i % 1000 === 999
                    ? ` User${i}@Example.com `
                    : `user${i}@example.com`,
            password: hash,
            role: 'user',
            isActive: true,
            tokenVersion: 0,
            refreshToken: [],
            legacyDisplay: i % 1000 === 999 ? 'C1 legacy' : undefined,
          };
        }),
      );
    }
    assert.equal(await User.countDocuments(), size);
    const seedMs = Date.now() - seedStart;
    const indexes = await User.collection.indexes();
    const explains = {};
    for (const [name, filter] of Object.entries({
      exactHit: { email: 'user123@example.com' },
      exactMiss: { email: 'absent-c1@example.com' },
      canonicalFallback: {},
    })) {
      const plan = await User.collection
        .find(filter, { projection: { _id: 1, email: 1 } })
        .explain('executionStats');
      explains[name] = { queryPlanner: plan.queryPlanner, executionStats: plan.executionStats };
    }
    await fixture.assertTarget();
    sampler = spawn('docker', ['stats', '--format', '{{json .}}', fixture.resource.id], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let partial = '';
    sampler.stdout.on('data', (chunk) => {
      partial += require('node:util').stripVTControlCharacters(chunk.toString());
      const lines = partial.split('\n');
      partial = lines.pop();
      for (const line of lines)
        try {
          const v = JSON.parse(line);
          stats.push({
            at: Date.now(),
            cpuPercent: v.CPUPerc,
            memory: v.MemUsage,
            memoryPercent: v.MemPerc,
            pids: v.PIDs,
          });
        } catch {
          /* Incomplete terminal line is excluded. */
        }
    });
    sampler.stderr.resume();
    const commandCounts = { exactFind: 0, scanFind: 0, getMore: 0 };
    mongoose.connection.getClient().on('commandStarted', (event) => {
      if (event.commandName === 'find' && event.command.find === 'users')
        commandCounts[
          Object.hasOwn(event.command.filter || {}, 'email') ? 'exactFind' : 'scanFind'
        ]++;
      if (event.commandName === 'getMore') commandCounts.getMore++;
    });
    const before = await fixture.client.db('admin').command({ serverStatus: 1 });
    const ticksPerSecond = Number(docker(['exec', fixture.resource.id, 'getconf', 'CLK_TCK']));
    assert(Number.isSafeInteger(ticksPerSecond) && ticksPerSecond > 0);
    function mongoCpu() {
      fixture.verify();
      const stat = docker(['exec', fixture.resource.id, 'cat', '/proc/1/stat']);
      assert(stat.startsWith('1 (mongod) '));
      const parts = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { userTicks: Number(parts[11]), systemTicks: Number(parts[12]) };
    }
    const results = {};
    async function measure(name, count, fn) {
      const mongoBefore = await fixture.client.db('admin').command({ serverStatus: 1 }),
        cpuBefore = mongoCpu(),
        windowStart = Date.now();
      const rows = [];
      for (let i = 0; i < count; i++) {
        const startedAt = Date.now();
        const cpu = process.cpuUsage(),
          start = performance.now();
        let outcome,
          timeout = false;
        try {
          outcome = await fn(i);
        } catch (error) {
          if (!/Timeout/.test(error.name)) throw error;
          timeout = true;
          outcome = error.name;
        }
        const used = process.cpuUsage(cpu);
        rows.push({
          startedAt,
          endedAt: Date.now(),
          ms: performance.now() - start,
          outcome,
          timeout,
          backendCpuUserMs: used.user / 1000,
          backendCpuSystemMs: used.system / 1000,
          backendRssBytes: process.memoryUsage().rss,
        });
      }
      const cpuAfter = mongoCpu(),
        mongoAfter = await fixture.client.db('admin').command({ serverStatus: 1 });
      results[name] = {
        ...quantiles(rows),
        rows,
        resourceWindow: {
          startedAt: windowStart,
          endedAt: Date.now(),
          mongoCpuUserMs: ((cpuAfter.userTicks - cpuBefore.userTicks) * 1000) / ticksPerSecond,
          mongoCpuSystemMs:
            ((cpuAfter.systemTicks - cpuBefore.systemTicks) * 1000) / ticksPerSecond,
          mongoResidentMiB: { before: mongoBefore.mem.resident, after: mongoAfter.mem.resident },
          counterResolutionMs: 1000 / ticksPerSecond,
          backendCpuUserMs: rows.reduce((s, r) => s + r.backendCpuUserMs, 0),
          backendCpuSystemMs: rows.reduce((s, r) => s + r.backendCpuSystemMs, 0),
          backendMaxRssBytes: Math.max(...rows.map((r) => r.backendRssBytes)),
        },
      };
      write('identity-progress.json', { run, size, results });
    }
    await measure('exactHit', 20, async () => {
      const u = await identity.findForAuthentication(User, 'user123@example.com');
      assert(u);
      return 'found';
    });
    await measure('exactIndexedMiss', 20, async () => {
      assert.equal(
        await User.findOne({ email: 'absent-c1@example.com' }, null, {
          timeoutMS: AUTH_READ_TIMEOUT_MS,
        }),
        null,
      );
      return 'absent';
    });
    await measure('canonicalCollisionNearTail', 10, async () => {
      assert.equal(await identity.findForAuthentication(User, 'COLLISION@EXAMPLE.COM'), null);
      return 'ambiguous-refused';
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const countBefore = { ...commandCounts };
    await measure('loginMissingCanonicalFallback', 10, async (i) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/home/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `nonexistent-c1-${i}@example.com`, password }),
        signal: AbortSignal.timeout(30000),
      });
      const status = res.status;
      await res.arrayBuffer();
      assert([401, 503].includes(status), 'C1 login must reach identity; status=' + status);
      return status;
    });
    const after = await fixture.client.db('admin').command({ serverStatus: 1 });
    assert(
      commandCounts.scanFind - countBefore.scanFind >= 10,
      'Missing login did not execute canonical fallback',
    );
    const missing = results.loginMissingCanonicalFallback;
    missing.http503Count = missing.rows.filter((r) => r.outcome === 503).length;
    missing.http503Ratio = missing.http503Count / missing.samples;
    missing.timeTo503Ms = missing.rows.filter((r) => r.outcome === 503).map((r) => r.ms);
    write('identity.json', {
      run,
      size,
      seedMs,
      authReadTimeoutMS: AUTH_READ_TIMEOUT_MS,
      indexes,
      explains,
      results,
      commandCounts,
      mongo: {
        before: { residentMiB: before.mem.resident, virtualMiB: before.mem.virtual },
        after: { residentMiB: after.mem.resident, virtualMiB: after.mem.virtual },
        dockerSamples: stats,
      },
      backend: {
        pid: process.pid,
        resourceUsage: process.resourceUsage(),
        memoryUsage: process.memoryUsage(),
      },
      fixtureMode:
        'Host app.js HTTP, NODE_ENV=test; real Mongo; local limiter; no Redis claim; concurrency 1',
      scaleDecision:
        '200k distinguishes IXSCAN vs COLLSCAN and actual login fallback. No extrapolation or production SLO; dataset not increased.',
      exitCode: 0,
    });
  } catch (error) {
    write('identity-error.json', {
      name: error.name,
      message: error.message.replace(/mongodb[^\s]*/gi, '[redacted]'),
    });
    process.exitCode = 1;
  } finally {
    if (sampler) {
      sampler.kill();
      await new Promise((r) => (sampler.exitCode !== null ? r() : sampler.once('exit', r)));
    }
    if (server) await new Promise((r) => server.close(r));
    await mongoose.disconnect();
    await fixture?.cleanup();
  }
})().catch(() => {
  process.exitCode = 1;
});
