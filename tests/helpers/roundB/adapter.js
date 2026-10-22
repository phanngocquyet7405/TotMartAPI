// Test-only adapter: unchanged B06 assertions target real HTTPS image entrypoints.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const https = require('node:https');
const config = require('/app/src/config/environment');
const sessions = new Map();
const observations = [];
let instance = 0;
const url = (index) => `https://api-${index ? 'stage' : 'prod'}.totmart.test:8443`;
function http(index, path, method = 'GET', body, headers = {}, deadline = 12000) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url(index) + path,
      {
        method,
        headers: {
          Origin: 'https://app.totmart.test',
          ...(payload === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          clearTimeout(timer);
          let value;
          try {
            value = text ? JSON.parse(text) : {};
          } catch {
            reject(
              Object.assign(Error('Invalid JSON HTTP response'), {
                code: 'FIXTURE_INVALID_JSON',
                httpStatus: res.statusCode,
                requestId: res.headers['x-request-id'] || null,
                bodyRedacted: '[UNPARSEABLE_RESPONSE_BODY_REDACTED]',
              }),
            );
            return;
          }
          observations.push({
            index,
            path: path.split('?')[0],
            method,
            status: res.statusCode,
            requestId: res.headers['x-request-id'],
            cors: res.headers['access-control-allow-origin'],
          });
          resolve({ status: res.statusCode, body: value, headers: res.headers });
        });
        res.on('error', reject);
      },
    );
    const timer = setTimeout(
      () =>
        req.destroy(
          Object.assign(Error('HTTP client deadline'), {
            code: 'FIXTURE_CLIENT_DEADLINE',
          }),
        ),
      deadline,
    );
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(payload);
  });
}
function request() {
  return Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path) => {
        const index = instance++ % 2,
          headers = {};
        let body;
        const chain = {
          set(key, value) {
            if (typeof key === 'object') Object.assign(headers, key);
            else headers[key] = value;
            return chain;
          },
          send(value) {
            body = value;
            return chain;
          },
          then(ok, fail) {
            return http(index, path, method.toUpperCase(), body, headers).then(ok, fail);
          },
        };
        return chain;
      },
    ]),
  );
}
async function owned() {
  const name = `totmart_b_${process.env.FIXTURE_RUN.replaceAll('-', '')}`;
  assert.equal(mongoose.connection.name, name, 'Owned fixture DB name');
  assert.equal(
    (
      await mongoose.connection.db
        .collection('_roundBRun')
        .findOne({ _id: process.env.FIXTURE_RUN })
    )?.owner,
    process.env.FIXTURE_RUN,
    'Owned fixture DB marker',
  );
}
const db = {
  async connect() {
    if (mongoose.connection.readyState === 1) {
      await owned();
      return;
    }
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 8000,
    });
    const name = `totmart_b_${process.env.FIXTURE_RUN.replaceAll('-', '')}`;
    assert.equal(mongoose.connection.name, name);
    await mongoose.connection.db
      .collection('_roundBRun')
      .updateOne(
        { _id: process.env.FIXTURE_RUN },
        { $setOnInsert: { owner: process.env.FIXTURE_RUN } },
        { upsert: true },
      );
    await owned();
    await require('/app/src/config/redis').startRedis();
  },
  async clearDatabase() {
    await owned();
    // Only the fresh fixture DB, guarded above; ownership marker is outside model collections.
    for (const model of Object.values(mongoose.models)) await model.collection.deleteMany({});
    sessions.clear();
  },
  async closeDatabase() {
    await require('/app/src/config/redis').stopRedis();
    await mongoose.disconnect();
  },
};
async function seedSession(user) {
  const sid = crypto.randomUUID();
  await require('/app/src/models/AuthSession').create({
    sessionId: sid,
    userId: user._id,
    refreshHash: crypto.randomBytes(32).toString('hex'),
    tokenVersion: user.tokenVersion ?? 0,
    expiresAt: new Date(Date.now() + 3600000),
  });
  sessions.set(String(user._id), sid);
  return sid;
}
function token(user, changes = {}) {
  assert(sessions.has(String(user._id)), 'Fixture DB session required');
  return require('jsonwebtoken').sign(
    {
      userId: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email,
      tokenVersion: user.tokenVersion ?? 0,
      sid: sessions.get(String(user._id)),
      ...changes,
    },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}
function expect(actual) {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toHaveLength(expected) {
      assert.strictEqual(actual.length, expected);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.equal(typeof actual, 'number');
      assert(actual >= expected);
    },
  };
}
async function business() {
  const result = {};
  for (const name of [
    'Checkout',
    'Order',
    'UserSubscription',
    'Product',
    'Coupon',
    'PaymentEvent',
    'PaymentAllocation',
    'ReceiptRefund',
    'PaymentAudit',
    'CheckoutAttempt',
    'BoxVersion',
    'Cart',
  ]) {
    const model = require(`/app/src/models/${name}`);
    result[name] = await model.find().sort({ _id: 1 }).lean();
  }
  return result;
}
const digest = (value) =>
  crypto.createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(value)).digest('hex');
module.exports = {
  assert,
  http,
  url,
  request,
  db,
  seedSession,
  token,
  expect,
  observations,
  business,
  digest,
};
