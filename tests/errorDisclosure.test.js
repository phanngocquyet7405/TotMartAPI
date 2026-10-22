const request = require('supertest');
const express = require('express');
const pino = require('pino');
const { resolveEnvironment } = require('../src/config/resolveEnvironment');
const { randomUUID } = require('node:crypto');

function fixture(mode) {
  jest.resetModules();
  const logs = [];
  const config = resolveEnvironment({
    NODE_ENV: mode,
    LOG_LEVEL: 'trace',
    JWT_SECRET: 'fixture-auth-key-with-diverse-characters-12345',
    JWT_REFRESH_SECRET: 'fixture-refresh-key-with-other-characters-67890',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/disposable',
    FRONTEND_URL: 'https://fixture.invalid',
    SEPAY_API_KEY: 'fixture-api-key',
    SEPAY_BANK_ACCOUNT: '0000000000',
    SEPAY_BANK_NAME: 'Fixture',
    REDIS_URL: 'rediss://127.0.0.1:6379',
    REDIS_NAMESPACE: 'fixture:disclosure',
    TRUST_PROXY: '1',
  });
  let handler, logger, drivers;
  jest.isolateModules(() => {
    jest.doMock('../src/config/environment', () => config);
    // Keep real Pino serialization/redaction; replace only its output destination.
    jest.doMock('pino', () =>
      Object.assign((options) => pino(options, { write: (line) => logs.push(JSON.parse(line)) }), {
        stdSerializers: pino.stdSerializers,
      }),
    );
    logger = require('../src/utils/logger');
    handler = require('../src/middleware/errorHandler');
    drivers = {
      mongo: require('mongoose').mongo,
      pool: require('mongodb/lib/cmap/errors'),
      redis: require('redis'),
    };
  });
  const requestId = randomUUID();
  const app = express();
  app.use((req, res, next) => {
    req.id = requestId;
    res.set('X-Request-Id', requestId);
    next();
  });
  const respond = async (error) => {
    app.use((req, res, next) => next(error));
    app.use(handler);
    return request(app)
      .post('/fixture?token=synthetic-query-value')
      .send({ token: 'synthetic-body-value' });
  };
  return { respond, logs, logger, requestId, drivers };
}

afterEach(() => {
  jest.dontMock('../src/config/environment');
  jest.dontMock('pino');
});

describe.each(['staging', 'production'])('%s error disclosure', (mode) => {
  test.each(['message', 'stack', 'cause', 'provider', 'name', 'code'])(
    'keeps a synthetic %s marker out of HTTP and real Pino output',
    async (field) => {
      const context = fixture(mode);
      const marker = `SYNTHETIC_DISCLOSURE_${randomUUID()}`;
      const error = Object.assign(new Error('Upstream request failed'), { statusCode: 500 });
      if (field === 'cause') error.cause = new Error(marker);
      else if (field === 'provider') {
        error.response = { data: { error: marker }, headers: { authorization: marker } };
        error.config = { body: marker, url: `https://fixture:${marker}@provider.invalid` };
      } else error[field] = field === 'code' ? `ATTEMPT_${marker}` : marker;
      const response = await context.respond(error);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        status: 500,
        message: 'Lỗi hệ thống. Vui lòng thử lại.',
        requestId: context.requestId,
      });
      expect(response.headers['x-request-id']).toBe(context.requestId);
      expect(JSON.stringify(response.body).includes(marker)).toBe(false);
      expect(context.logs.length).toBe(1);
      const published = JSON.stringify(context.logs);
      expect(published.includes(marker)).toBe(false);
      expect(published.includes('synthetic-query-value')).toBe(false);
      expect(published.includes('synthetic-body-value')).toBe(false);
      expect(context.logs[0]).toMatchObject({
        level: 50,
        event: 'request_failed',
        requestId: context.requestId,
        status: 500,
      });
      expect(context.logs[0].err).not.toHaveProperty('stack');
      expect(context.logs[0].err).not.toHaveProperty('cause');
      expect(context.logs[0].err).not.toHaveProperty('response');
    },
  );

  test.each(['MongoNetworkError', 'MongoOperationTimeoutError'])(
    'retains dependency/event/type/code/requestId for a %s 503',
    async (name) => {
      const context = fixture(mode);
      const response = await context.respond(
        Object.assign(new Error('Private upstream explanation'), {
          name,
          code: 'ECONNRESET',
          dependency: 'MongoDB',
        }),
      );
      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Lỗi hệ thống. Vui lòng thử lại.');
      expect(context.logs[0]).toMatchObject({
        dependency: 'MongoDB',
        event: 'request_failed',
        requestId: context.requestId,
        err: { type: name, code: 'ECONNRESET' },
      });
    },
  );

  test.each([
    ['MongoNetworkTimeoutError', (d) => new d.mongo.MongoNetworkTimeoutError('fixture')],
    ['MongoTopologyClosedError', (d) => new d.mongo.MongoTopologyClosedError()],
    ['MongoServerClosedError', (d) => new d.mongo.MongoServerClosedError()],
    ['MongoClientClosedError', (d) => new d.mongo.MongoClientClosedError()],
    ['MongoPoolClosedError', (d) => new d.pool.PoolClosedError({ address: 'fixture.invalid' })],
    ['MongoPoolClearedError', (d) => new d.pool.PoolClearedError({ address: 'fixture.invalid' })],
    [
      'PoolClearedOnNetworkError',
      (d) => new d.pool.PoolClearedOnNetworkError({ address: 'fixture.invalid' }),
    ],
    [
      'MongoWaitQueueTimeoutError',
      (d) => new d.pool.WaitQueueTimeoutError('fixture', 'fixture.invalid'),
    ],
    ...[
      'ConnectionTimeoutError',
      'SocketTimeoutError',
      'ClientClosedError',
      'ClientOfflineError',
      'DisconnectsClientError',
      'SocketClosedUnexpectedlyError',
      'RootNodesUnavailableError',
    ].map((name) => [name, (d) => new d.redis[name]()]),
  ])('maps the installed driver availability class %s to safe503', async (name, make) => {
    const context = fixture(mode);
    const error = make(context.drivers);
    expect(error.name === name || (error.name === 'Error' && error.constructor.name === name)).toBe(
      true,
    );
    const response = await context.respond(error);
    expect(response.status).toBe(503);
    expect(response.body.requestId).toBe(context.requestId);
    expect(response.body.message).toBe('Lỗi hệ thống. Vui lòng thử lại.');
  });

  test.each([
    'MongoBusinessError',
    'MongoBulkWriteError',
    'MongoServerError',
    'RedisBusinessError',
    'ErrorReply',
    'WatchError',
    'AbortError',
    'TimeoutError',
    'SocketTimeoutErrorBusiness',
  ])('does not remap the business/non-availability name %s', async (name) => {
    const context = fixture(mode);
    const response = await context.respond(
      Object.assign(new Error('Published domain conflict'), {
        name,
        statusCode: 409,
        code: 'ATTEMPT_PAYLOAD_MISMATCH',
      }),
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ATTEMPT_PAYLOAD_MISMATCH');
    expect(response.body.message).toBe('Published domain conflict');
  });

  test.each([400, 401, 403, 404, 409, 413, 422, 429])(
    'preserves a published %i status/code/message',
    async (statusCode) => {
      const context = fixture(mode);
      const response = await context.respond(
        Object.assign(new Error('Published client error'), {
          statusCode,
          code: 'ATTEMPT_PAYLOAD_MISMATCH',
        }),
      );
      expect(response.status).toBe(statusCode);
      expect(response.body).toMatchObject({
        status: statusCode,
        code: 'ATTEMPT_PAYLOAD_MISMATCH',
        message: 'Published client error',
      });
    },
  );
});

test('keeps local test-mode diagnostics available', async () => {
  const context = fixture('test');
  const response = await context.respond(new Error('Synthetic local diagnostic'));
  expect(response.status).toBe(500);
  expect(response.body.message).toBe('Synthetic local diagnostic');
  expect(context.logs[0].err.message).toBe('Synthetic local diagnostic');
});
