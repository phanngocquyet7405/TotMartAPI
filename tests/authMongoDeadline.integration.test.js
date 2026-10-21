const mockLogs = [];
jest.mock('../src/config/environment', () =>
  require('../src/config/resolveEnvironment').resolveEnvironment({
    NODE_ENV: 'staging',
    LOG_LEVEL: 'info',
    JWT_SECRET: 'fixture-auth-key-with-diverse-characters-12345',
    JWT_REFRESH_SECRET: 'fixture-refresh-key-with-other-characters-67890',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/disposable',
    FRONTEND_URL: 'https://fixture.invalid',
    SEPAY_API_KEY: 'fixture-api-key',
    SEPAY_BANK_ACCOUNT: '0000000000',
    SEPAY_BANK_NAME: 'Fixture',
    REDIS_URL: 'rediss://127.0.0.1:6379',
    REDIS_NAMESPACE: 'fixture:auth-deadline',
    TRUST_PROXY: '1',
  }),
);
jest.mock('pino', () => {
  const pino = jest.requireActual('pino');
  return Object.assign(
    (options) => pino(options, { write: (line) => mockLogs.push(JSON.parse(line)) }),
    pino,
  );
});
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const { disposableMongo } = require('./helpers/disposableMongo');
const auth = require('../src/controllers/authController');
const validate = require('../src/middleware/validationHandler').validate;
const schema = require('../src/middleware/validationSchemas').loginSchema;
const errorHandler = require('../src/middleware/errorHandler');
const User = require('../src/models/User');
const Session = require('../src/models/AuthSession');
const output = process.env.B07_RESOURCE_FILE
  ? path.dirname(process.env.B07_RESOURCE_FILE)
  : 'artifacts/round-a';
const evidenceFile = path.join(output, `mongo-auth-deadline-${randomUUID()}.json`);
const evidence = { scenario: 'auth-mongo-read-deadline', fixtureOnly: true };
function save() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
}
let mongo;
beforeAll(async () => {
  mongo = await disposableMongo((value) => {
    evidence.resource = value;
    save();
  });
  await mongoose.connect(mongo.uri(mongo.database), { serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.init(), Session.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.cleanup();
  const ids = execFileSync('docker', ['ps', '-a', '--no-trunc', '--format', '{{.ID}}'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split(/\s+/);
  evidence.resource.absent = !ids.includes(evidence.resource.id);
  save();
  expect(evidence.resource.cleaned).toBe(true);
  expect(evidence.resource.absent).toBe(true);
});
test('login returns a safe correlated 5xx before the unchanged 16s client deadline when Mongo find is silent', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });
  // Exercise the published route's validation/controller/error chain with real Mongo I/O.
  // Redis limiter and proxy are covered by the strict-image scenario, not this fixture.
  app.post('/api/home/login', validate(schema), auth.login.bind(auth));
  app.use(errorHandler);
  const before = { users: await User.countDocuments(), sessions: await Session.countDocuments() };
  const point = await mongo.failpoint({
    mode: { times: 1 },
    data: {
      failCommands: ['find'],
      blockConnection: true,
      blockTimeMS: 20000,
    },
  });
  const started = Date.now();
  let result;
  try {
    const pending = request(app)
      .post('/api/home/login')
      .send({ email: 'disclosure@example.com', password: 'synthetic-fixture-password' })
      .timeout({ deadline: 16000 })
      .then(
        (response) => ({ response }),
        (error) => ({ timeout: error.timeout, code: error.code }),
      );
    await mongoose.connection.db.admin().command({
      waitForFailPoint: 'failCommand',
      timesEntered: point.count + 1,
      maxTimeMS: 3000,
    });
    evidence.serverBarrierObserved = true;
    result = await pending;
    evidence.durationMs = Date.now() - started;
    evidence.status = result.response?.status ?? 0;
    evidence.clientTimeout = result.timeout ?? null;
    evidence.requestId = result.response?.headers['x-request-id'];
    evidence.body = result.response?.body;
  } finally {
    await mongo.failpoint({ mode: 'off' });
    evidence.recovered = (await mongoose.connection.db.admin().command({ ping: 1 })).ok === 1;
    evidence.after = {
      users: await User.countDocuments(),
      sessions: await Session.countDocuments(),
    };
    evidence.logs = mockLogs;
    save();
  }
  expect(evidence.serverBarrierObserved).toBe(true);
  expect(evidence.recovered).toBe(true);
  expect(evidence.after).toEqual(before);
  expect(result.timeout).toBeUndefined();
  expect([500, 503]).toContain(result.response.status);
  expect(result.response.body).toEqual({
    success: false,
    status: result.response.status,
    message: 'Lỗi hệ thống. Vui lòng thử lại.',
    requestId: evidence.requestId,
  });
  expect(evidence.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(mockLogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'request_failed',
        requestId: evidence.requestId,
        status: result.response.status,
      }),
    ]),
  );
  expect(JSON.stringify(mockLogs)).not.toMatch(
    /mongodb:\/\/|blockTimeMS|stack|synthetic-fixture-password/,
  );
});
