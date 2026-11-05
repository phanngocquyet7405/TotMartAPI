const { fork } = require('node:child_process');
const net = require('node:net');
const { writeFileSync } = require('node:fs');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const { disposableRedis } = require('./helpers/disposableRedis');
let lease,
  base,
  children = [];
const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
beforeAll(async () => {
  if (process.env.TEST_MONGODB_URI)
    throw new Error('Server boot drill requires its own Mongo replica set');
  await db.connect();
  lease = await disposableRedis({
    purpose: 'server-boot',
    onEvidence: (evidence) => {
      if (process.env.B05_SERVER_RESOURCE_FILE)
        writeFileSync(process.env.B05_SERVER_RESOURCE_FILE, JSON.stringify(evidence) + '\n');
    },
  });
  base = {
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: mongoose.connection.getClient().s.url,
    REDIS_URL: lease.url,
    REDIS_NAMESPACE: 'fixture:server-boot',
    TRUST_PROXY: '0',
    FRONTEND_URL: 'https://fixture.invalid',
    JWT_SECRET: 'fixture-auth-key-for-server-process-12345',
    JWT_REFRESH_SECRET: 'fixture-refresh-key-for-server-process-67890',
    CLOUDINARY_CLOUD_NAME: 'fixture',
    CLOUDINARY_API_KEY: 'fixture-api',
    CLOUDINARY_API_SECRET: 'fixture-secret',
    SEPAY_API_KEY: 'fixture-bank-key',
    SEPAY_BANK_ACCOUNT: '0000000000',
    SEPAY_BANK_NAME: 'Fixture',
  };
}, 120000);
function spawn(overrides) {
  const env = { ...base, ...overrides };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = fork(require.resolve('../src/server'), [], {
    env,
    windowsHide: true,
    execArgv: ['--require', require.resolve('./helpers/server-signals')],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.startupOutput = '';
  child.stderr.on('data', (data) => {
    child.startupOutput = (child.startupOutput + data).slice(0, 8192);
  });
  children.push(child);
  return child;
}
const exited = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, signal: 'fixture-timeout' });
    }, 15000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
afterAll(async () => {
  try {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited(child);
      }
  } finally {
    try {
      await db.closeDatabase();
    } finally {
      lease?.cleanup();
    }
  }
});
test('real server readiness follows topology/index checks; shutdown handler exits cleanly', async () => {
  const port = await freePort(),
    child = spawn({ PORT: String(port) });
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      ready =
        (
          await fetch(`http://127.0.0.1:${port}/api/home/health`, {
            signal: AbortSignal.timeout(1000),
          })
        ).status === 200;
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(ready).toBe(true);
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  expect(Boolean(topology.setName)).toBe(true);
  const indexes = await mongoose.connection.collection('authsessions').indexes();
  expect(indexes.some((index) => index.key.sessionId === 1 && index.unique)).toBe(true);
  expect(indexes.some((index) => index.key['history.hash'] === 1)).toBe(true);
  const ending = exited(child);
  if (process.platform === 'win32') child.send('fixture-sigterm');
  else child.kill('SIGTERM');
  expect(await ending).toEqual({ code: 0, signal: null });
});
test.each([
  ['invalid port', { PORT: 'invalid' }, 'PORT'],
  ['invalid Mongo URL', { MONGODB_URI: 'https://invalid' }, 'MONGODB_URI'],
  ['missing server integration', { CLOUDINARY_API_KEY: undefined }, 'CLOUDINARY_API_KEY'],
  ['missing strict Redis', { NODE_ENV: 'staging', REDIS_URL: undefined }, 'REDIS_URL'],
  [
    'missing strict refresh secret',
    { NODE_ENV: 'production', JWT_REFRESH_SECRET: undefined },
    'JWT_REFRESH_SECRET',
  ],
])('real entrypoint rejects %s before readiness', async (name, overrides, key) => {
  const child = spawn({ PORT: String(await freePort()), ...overrides });
  expect(await exited(child)).toEqual({ code: 1, signal: null });
  const diagnostic =
    child.startupOutput.split('\n').find((line) => line.startsWith('Error:')) || '';
  expect(diagnostic.includes(key)).toBe(true);
});
