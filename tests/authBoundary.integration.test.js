const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const auth = require('../src/middleware/authMiddleware');
const User = require('../src/models/User');
const Session = require('../src/models/AuthSession');
const app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser } = require('./helpers/factories');
const config = require('../src/config/environment');

beforeAll(() => connect());
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDatabase();
});
afterAll(closeDatabase);

async function fixture(role = 'admin') {
  const { user } = await createUser({ role });
  const sid = randomUUID();
  await Session.create({
    sessionId: sid,
    userId: user._id,
    tokenVersion: 0,
    refreshHash: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const token = jwt.sign(
    { userId: String(user._id), role, sid, tokenVersion: 0 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
  return { user, sid, token };
}
const get = (token, path = '/api/admin/gifts') =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

test.each(['user', 'merchant', 'admin'])(
  '%s respects the real profile ownership guard',
  async (role) => {
    const { user, token } = await fixture(role),
      other = (await createUser()).user;
    const own = `/api/users/get-user-by-id/${user._id}`;
    const foreign = `/api/users/get-user-by-id/${other._id}`;
    expect((await request(app).get(own)).status).toBe(401);
    expect((await get(token, own)).status).toBe(200);
    expect((await get(token, foreign)).status).toBe(role === 'admin' ? 200 : 403);
    expect((await get(token)).status).toBe(role === 'admin' ? 200 : 403);
    expect((await get(token, '/api/manager/products')).status).toBe(
      role === 'merchant' ? 200 : 403,
    );
  },
);

test('ID validation precedes authorization, which precedes payload validation', async () => {
  const { token } = await fixture('user');
  const path = '/api/users/lock-user/';
  expect((await request(app).delete(path + 'invalid')).status).toBe(401);
  expect(
    (
      await request(app)
        .delete(path + 'invalid')
        .set('Authorization', `Bearer ${token}`)
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .delete(path + '507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${token}`)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/api/admin/merchants/507f1f77bcf86cd799439011/brands')
        .set('Authorization', `Bearer ${token}`)
        .send({})
    ).status,
  ).toBe(403);
});

test('admin role does not bypass checkout attempt ownership', async () => {
  const owner = await fixture('user'),
    admin = await fixture('admin');
  const key = 'b02-owned-attempt-key',
    hash = 'a'.repeat(64);
  await require('../src/models/CheckoutAttempt').create({
    userId: owner.user._id,
    kind: 'products',
    key,
    hash,
    state: 'invalidated',
  });
  const path = `/api/checkout/attempts/products/${key}`;
  const own = await get(owner.token, path).set('Attempt-Payload-Hash', hash);
  expect(own.status).toBe(200);
  expect(own.body.data.state).toBe('invalidated');
  const foreign = await get(admin.token, path).set('Attempt-Payload-Hash', hash);
  expect(foreign.status).toBe(200);
  expect(foreign.body.data).toEqual({ state: 'unknown', canRestart: false });
});

test.each([
  '/api/admin/gifts',
  '/api/users/get-all-users',
  '/api/manager/products',
  '/api/admin/operations/health-summary',
])('%s authenticates User and session exactly once', async (path) => {
  const { token } = await fixture(path.includes('/manager/') ? 'merchant' : 'admin');
  const users = jest.spyOn(User, 'findById'),
    sessions = jest.spyOn(Session, 'exists');
  expect((await get(token, path)).status).toBe(200);
  const expected = path.includes('/manager/')
    ? 1
    : Number(process.env.B02_EXPECT_AUTH_QUERIES || 1);
  expect(users).toHaveBeenCalledTimes(expected);
  expect(sessions).toHaveBeenCalledTimes(expected);
});

test('operations summary rejects anonymous and non-admin roles before reading operational data', async () => {
  const path = '/api/admin/operations/health-summary';
  expect((await request(app).get(path)).status).toBe(401);
  for (const role of ['user', 'merchant']) {
    const { token } = await fixture(role);
    expect((await get(token, path)).status).toBe(403);
  }
});

test('reconciliation reads require admin and remain reachable by the current DB admin role', async () => {
  const path = '/api/admin/reconciliation/refunds';
  expect((await request(app).get(path)).status).toBe(401);
  for (const role of ['user', 'merchant', 'admin']) {
    const { token } = await fixture(role);
    expect((await get(token, path)).status).toBe(role === 'admin' ? 200 : 403);
  }
});

test.each([
  ['patch', '/api/manager/products/invalid/stock', 'merchant'],
  ['patch', '/api/admin/gifts/invalid', 'admin'],
  ['post', '/api/admin/reconciliation/refunds/invalid/complete', 'admin'],
])(
  '%s %s validates ID before role and payload at the moved guard boundary',
  async (method, path, allowedRole) => {
    expect((await request(app)[method](path).send({})).status).toBe(401);
    for (const role of ['user', allowedRole]) {
      const { token } = await fixture(role);
      expect(
        (await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({})).status,
      ).toBe(400);
    }
    const { token } = await fixture('user');
    const validIdPath = path.replace('invalid', '507f1f77bcf86cd799439011');
    const client = request(app);
    const denied = await client[method](validIdPath)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(denied.status).toBe(403);
  },
);

test.each([
  '/api/manager/b02-no-such-route',
  '/api/admin/gifts/507f1f77bcf86cd799439011/b02-no-such-route',
  '/api/admin/merchants/507f1f77bcf86cd799439011/b02-no-such-route',
  '/api/admin/reconciliation/b02-no-such-route',
])('unknown subpath %s authenticates at mount but has no route role guard', async (path) => {
  expect((await request(app).get(path)).status).toBe(401);
  for (const role of ['user', 'merchant', 'admin']) {
    const { token } = await fixture(role);
    const response = await get(token, path);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Route not found');
  }
});

test('unknown admin subpath outside gifts and merchants falls through without JWT authentication', async () => {
  const response = await request(app).get('/api/admin/b02-no-such-route');
  expect(response.status).toBe(404);
  expect(response.body.message).toBe('Route not found');
});

test('attempt prepare does not repeat authentication after the mounted boundary', async () => {
  const { token } = await fixture('user');
  const users = jest.spyOn(User, 'findById'),
    sessions = jest.spyOn(Session, 'exists');
  expect(
    (
      await request(app)
        .post('/api/checkout/attempts/products/prepare')
        .set('Authorization', `Bearer ${token}`)
        .send({})
    ).status,
  ).toBe(400);
  expect(users).toHaveBeenCalledTimes(Number(process.env.B02_EXPECT_AUTH_QUERIES || 1));
  expect(sessions).toHaveBeenCalledTimes(Number(process.env.B02_EXPECT_AUTH_QUERIES || 1));
});

test('same token observes DB role demotion and promotion on the next request', async () => {
  const { user, token } = await fixture();
  expect((await get(token)).status).toBe(200);
  await User.updateOne({ _id: user._id }, { $set: { role: 'user' } });
  expect((await get(token)).status).toBe(403);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  expect((await get(token)).status).toBe(200);
});

test.each(['delete', 'expire', 'version', 'owner'])(
  'session %s invalidates the next request',
  async (change) => {
    const { token, sid } = await fixture();
    expect((await get(token)).status).toBe(200);
    if (change === 'delete') await Session.deleteOne({ sessionId: sid });
    else
      await Session.updateOne(
        { sessionId: sid },
        {
          $set:
            change === 'expire'
              ? { expiresAt: new Date(0) }
              : change === 'version'
                ? { tokenVersion: 1 }
                : { userId: (await createUser()).user._id },
        },
      );
    expect((await get(token)).status).toBe(401);
  },
);

test.each(['lock', 'version', 'delete'])('user %s invalidates the next request', async (change) => {
  const { user, token } = await fixture();
  expect((await get(token)).status).toBe(200);
  if (change === 'delete') await User.deleteOne({ _id: user._id });
  else
    await User.updateOne(
      { _id: user._id },
      { $set: change === 'lock' ? { isActive: false } : { tokenVersion: 1 } },
    );
  expect((await get(token)).status).toBe(change === 'lock' ? 403 : change === 'delete' ? 404 : 401);
});

test('production still requires sid and role guard fails closed without authentication', async () => {
  const isolated = express();
  isolated.get('/role', auth.requireRole('admin'), (req, res) => res.sendStatus(200));
  isolated.get('/auth', auth.authMiddleware, (req, res) => res.sendStatus(200));
  expect((await request(isolated).get('/role')).status).toBe(401);
  const { user } = await createUser({ role: 'admin' });
  const token = jwt.sign(
    { userId: String(user._id), role: 'admin', tokenVersion: 0 },
    config.jwt.secret,
  );
  const previous = process.env.NODE_ENV;
  try {
    jest.spyOn(require('../src/config/sessionPolicy'), 'strictSessions').mockReturnValue(true);
    expect(
      (await request(isolated).get('/auth').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
  } finally {
    process.env.NODE_ENV = previous;
    jest.restoreAllMocks();
  }
});

test.each(['/api/admin/gifts', '/api/users/get-all-users'])(
  '%s forwards expired JWT and database errors without changing their response',
  async (path) => {
    const { user, token } = await fixture();
    const expired = jwt.sign({ userId: String(user._id), role: 'admin' }, config.jwt.secret, {
      expiresIn: -1,
    });
    const invalid = await get(expired, path);
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe('Invalid or expired token');
    jest
      .spyOn(User, 'findById')
      .mockRejectedValueOnce(
        Object.assign(new Error('Synthetic fixture outage'), { name: 'MongoNetworkError' }),
      );
    const unavailable = await get(token, path);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.message).toBe('Database temporarily unavailable');
  },
);
