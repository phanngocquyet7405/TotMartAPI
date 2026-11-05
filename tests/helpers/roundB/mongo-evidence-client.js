const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { A, F, purchaseFixture } = require('./client');
const stateFile = '/fixture/private-mongo-evidence.json';
const requestsFile = '/fixture/mongo-requests.jsonl';
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let state;
function load() {
  return (state ||= JSON.parse(fs.readFileSync(stateFile)));
}
function save() {
  fs.writeFileSync(stateFile, JSON.stringify(state));
}
function protectKey(key) {
  if (!key) return null;
  const s = load();
  if (!s.encoded[key]) {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(s.cipher, 'base64'), iv);
    const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
    s.encoded[key] =
      'aes-256-gcm:' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
    save();
  }
  return s.encoded[key];
}
function safeBody(body) {
  if (!body || typeof body !== 'object') return { nonObject: true };
  const value = {};
  for (const field of ['success', 'status', 'message', 'code', 'requestId'])
    if (body[field] !== undefined) value[field] = body[field];
  if (body.data !== undefined) value.dataHash = hash(body.data);
  return JSON.parse(
    JSON.stringify(value)
      .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s"\\]+/gi, '[REDACTED_URI]')
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]'),
  );
}
function request(
  index,
  path,
  method = 'GET',
  body,
  headers = {},
  deadlineMs = 12000,
  purpose = 'probe',
) {
  const trace = crypto.randomUUID(),
    startedAt = Date.now();
  const key = headers['Idempotency-Key'];
  const row = {
    trace,
    index,
    path: path.split('?')[0],
    method,
    purpose,
    keyEncrypted: protectKey(key),
    bodyHash: body === undefined ? null : hash(body),
    startedAt,
    deadlineMs,
    status: null,
    xRequestId: null,
    outcome: 'pending',
  };
  const append = (event) =>
    fs.appendFileSync(requestsFile, JSON.stringify({ ...row, event, at: Date.now() }) + '\n');
  append('started');
  return new Promise((resolve) => {
    let settled = false,
      timer,
      responseBody,
      timedOut = false;
    const finish = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      Object.assign(row, fields, { endedAt: Date.now(), durationMs: Date.now() - startedAt });
      append('completed');
      resolve({ record: row, body: responseBody });
    };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      A.url(index) + path,
      {
        method,
        headers: {
          Origin: 'https://app.totmart.test',
          'X-Fixture-Trace': trace,
          ...(payload === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        row.status = res.statusCode;
        row.xRequestId = res.headers['x-request-id'] || null;
        row.responseHeadersAt = Date.now();
        append('response_headers');
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          try {
            responseBody = text ? JSON.parse(text) : {};
            finish({ outcome: 'http_response', body: safeBody(responseBody) });
          } catch {
            finish({
              outcome: 'response_parse_error',
              transport: { kind: 'invalid_json', code: null },
              bodyBytes: Buffer.byteLength(text),
            });
          }
        });
        res.on('aborted', () =>
          finish({
            outcome: 'response_aborted',
            transport: { kind: 'response_aborted', code: 'ECONNRESET' },
          }),
        );
        res.on('error', (error) =>
          finish({
            outcome: 'transport_error',
            transport: { kind: 'response_error', code: error.code || null },
          }),
        );
      },
    );
    timer = setTimeout(() => {
      timedOut = true;
      req.destroy(
        Object.assign(new Error('Fixture client deadline'), { code: 'FIXTURE_CLIENT_DEADLINE' }),
      );
    }, deadlineMs);
    req.on('error', (error) =>
      finish({
        outcome: timedOut ? 'client_timeout' : 'transport_error',
        transport: {
          kind: timedOut ? 'client_timeout' : 'request_error',
          code: error.code || null,
          deadlineMs: timedOut ? deadlineMs : undefined,
        },
      }),
    );
    req.end(payload);
  });
}
async function connectReadOnly() {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 8000,
  });
  assert.equal(
    mongoose.connection.name,
    'totmart_b_' + process.env.FIXTURE_RUN.replaceAll('-', ''),
  );
  assert.equal(
    (
      await mongoose.connection.db
        .collection('_roundBRun')
        .findOne({ _id: process.env.FIXTURE_RUN })
    )?.owner,
    process.env.FIXTURE_RUN,
  );
}
const projections = {
  Product: '_id stock instock ownerId brand',
  Coupon: '_id code usedCount usageLimit',
  Order:
    '_id userId merchantId paymentCode totalAmount discountAmount couponCode paymentMethod paymentStatus status stockDeducted products.productId products.quantity products.totalPrice',
  Checkout:
    '_id userId requestKey requestHash paymentCode kind orderIds totalAmount paymentMethod state receivedAmount overpaidAmount couponCode couponReleased revision result',
  CheckoutAttempt: '_id userId kind key hash state revision result createdAt updatedAt',
  PaymentEvent:
    '_id referenceCode paymentCode transferAmount state disposition paymentLedgerVersion',
  PaymentAllocation: '_id eventId checkoutId amount',
  ReceiptRefund: '_id eventId checkoutId amount status purpose',
  PaymentAudit: '_id key checkoutId eventId action amount',
  AuthSession:
    '_id userId sessionId tokenVersion expiresAt revokedAt history.consumedAt history.retries',
  User: '_id tokenVersion isActive role checkoutAttemptRevision',
  Cart: '_id userId isSubscribeCart items.productId items.quantity version',
};
async function snapshot(label) {
  await connectReadOnly();
  const session = await mongoose.startSession();
  let collections;
  try {
    await session.withTransaction(
      async () => {
        collections = {};
        for (const [name, fields] of Object.entries(projections)) {
          const Model = require('/app/src/models/' + name);
          const rows = await Model.find({}, fields).sort({ _id: 1 }).session(session).lean();
          for (const row of rows) {
            if (row.requestKey)
              ((row.requestKeyEncrypted = protectKey(row.requestKey)), delete row.requestKey);
            if (row.key) ((row.keyEncrypted = protectKey(row.key)), delete row.key);
            if (row.sessionId) ((row.sessionIdHash = hash(row.sessionId)), delete row.sessionId);
          }
          collections[name] = rows;
        }
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
  const value = {
    label,
    at: Date.now(),
    collections: JSON.parse(JSON.stringify(collections)),
    hash: hash(collections),
  };
  fs.writeFileSync('/fixture/snapshot-' + label + '.json', JSON.stringify(value));
  return value;
}
function invariant(value, expected) {
  const c = value.collections;
  assert.equal(c.Checkout.length, expected);
  assert.equal(c.Order.length, expected);
  assert.equal(c.CheckoutAttempt.length, expected);
  assert(c.CheckoutAttempt.every((row) => row.state === 'created'));
  assert.equal(c.Product.find((row) => row._id === load().f.product._id).stock, 100 - expected);
  assert.equal(c.PaymentEvent.length, 0);
  assert.equal(c.PaymentAllocation.length, 0);
  assert.equal(c.ReceiptRefund.length, 0);
  assert(c.Coupon.every((row) => (row.usedCount || 0) === 0));
  assert(
    c.Checkout.every(
      (row) => row.paymentMethod === 'cod' && row.receivedAmount === 0 && row.orderIds.length === 1,
    ),
  );
  assert(
    c.Order.every(
      (row) => row.paymentMethod === 'cod' && row.paymentStatus !== 'paid' && row.stockDeducted,
    ),
  );
  const initial = JSON.parse(fs.readFileSync('/fixture/snapshot-before.json')).collections
    .AuthSession;
  assert.deepStrictEqual(c.AuthSession, initial);
  for (const checkout of c.Checkout) {
    const order = c.Order.find((row) => row._id === checkout.orderIds[0]);
    assert(order);
    assert.equal(order.paymentCode, checkout.paymentCode);
    const attempt = c.CheckoutAttempt.find(
      (row) => row.keyEncrypted === checkout.requestKeyEncrypted,
    );
    assert(attempt);
    assert.deepStrictEqual(attempt.result, checkout.result);
  }
  return {
    stock: 100 - expected,
    orders: expected,
    checkouts: expected,
    createdAttempts: expected,
    receiptAmount: 0,
    allocationAmount: 0,
    couponDelta: 0,
    sessionsUnchanged: true,
    CODPendingNeedsNoReceiptAllocation: true,
  };
}
async function watch() {
  const saved = load();
  const ticket = await request(
    1,
    '/api/admin/notifications/stream-ticket',
    'GET',
    undefined,
    { Authorization: 'Bearer ' + saved.adminJwt },
    12000,
    'SSE ticket barrier',
  );
  assert.equal(ticket.record.status, 200);
  const trace = crypto.randomUUID(),
    startedAt = Date.now();
  const row = {
    trace,
    index: 1,
    path: '/api/admin/notifications/stream',
    method: 'GET',
    purpose: 'SSE barrier',
    keyEncrypted: null,
    startedAt,
    deadlineMs: 240000,
    status: null,
    xRequestId: null,
  };
  fs.appendFileSync(
    requestsFile,
    JSON.stringify({ ...row, event: 'started', at: startedAt }) + '\n',
  );
  await new Promise((resolve, reject) => {
    const req = https.get(
      A.url(1) + row.path + '?ticket=' + encodeURIComponent(ticket.body.data.ticket),
      { headers: { Origin: 'https://app.totmart.test', 'X-Fixture-Trace': trace } },
      (res) => {
        Object.assign(row, {
          status: res.statusCode,
          xRequestId: res.headers['x-request-id'] || null,
          responseHeadersAt: Date.now(),
        });
        assert.equal(res.statusCode, 200);
        fs.appendFileSync(
          requestsFile,
          JSON.stringify({ ...row, event: 'response_headers', at: Date.now() }) + '\n',
        );
        fs.writeFileSync(
          '/fixture/watch-ready-evidence.json',
          JSON.stringify({ opened: true, trace, at: Date.now() }),
        );
        res.resume();
        res.once('close', () => {
          fs.writeFileSync(
            '/fixture/watch-closed-evidence.json',
            JSON.stringify({ closed: true, at: Date.now() }),
          );
          fs.appendFileSync(
            requestsFile,
            JSON.stringify({
              ...row,
              event: 'completed',
              outcome: 'sse_closed',
              endedAt: Date.now(),
              durationMs: Date.now() - startedAt,
              at: Date.now(),
            }) + '\n',
          );
          clearTimeout(timer);
          resolve();
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      reject(Error('SSE observation deadline'));
    }, 240000);
    req.on('error', reject);
  });
}
async function main() {
  const mode = process.argv[2];
  let result = { mode };
  try {
    if (mode === 'setup') {
      await A.db.connect();
      const f = await purchaseFixture('products'),
        admin = (await F.createUser({ role: 'admin' })).user;
      state = {
        f,
        adminJwt: A.token(admin),
        newKey: crypto.randomUUID(),
        cipher: crypto.randomBytes(32).toString('base64'),
        encoded: {},
      };
      save();
      protectKey(f.key);
      protectKey(state.newKey);
      await A.db.closeDatabase();
      result = {
        ...result,
        snapshot: await snapshot('before'),
        keyEncrypted: protectKey(f.key),
        bodyHash: hash(f.body),
      };
    } else if (mode === 'watch') {
      await watch();
    } else if (mode === 'outage') {
      const saved = load();
      result.responses = [];
      const deadlineMs = Number(process.argv[3]);
      assert([45000, 240000].includes(deadlineMs));
      await Promise.all(
        [0, 1].map(async (index) => {
          for (const path of ['/api/home/health', '/api/home/live'])
            result.responses.push((await request(index, path)).record);
          result.responses.push(
            (
              await request(
                index,
                '/api/home/login',
                'POST',
                { email: 'silent.fixture@example.com', password: 'Synthetic-Fixture-Only' },
                {},
                45000,
                'outage login',
              )
            ).record,
          );
          result.responses.push(
            (
              await request(
                index,
                saved.f.path,
                'POST',
                saved.f.body,
                { ...saved.f.auth, 'Idempotency-Key': saved.f.key },
                deadlineMs,
                'outage checkout',
              )
            ).record,
          );
        }),
      );
    } else if (mode === 'health') {
      result.responses = await Promise.all(
        [0, 1].map(async (index) => (await request(index, '/api/home/health')).record),
      );
      result.ready = result.responses.every(
        (row) => row.outcome === 'http_response' && row.status === 200,
      );
    } else if (mode === 'snapshot-reconnected') {
      result.snapshot = await snapshot('reconnected');
    } else if (mode === 'snapshot-delayed') {
      result.snapshot = await snapshot('delayed');
      const count = result.snapshot.collections.Checkout.length;
      assert(count <= 1);
      if (count === 1) result.checks = invariant(result.snapshot, 1);
      else {
        const c = result.snapshot.collections;
        assert.equal(c.Order.length, 0);
        assert.equal(c.Product.find((row) => row._id === load().f.product._id).stock, 100);
        assert.equal(c.PaymentEvent.length, 0);
        assert.equal(c.PaymentAllocation.length, 0);
        assert(c.CheckoutAttempt.length <= 1);
        result.checks = {
          noCommittedObligation: true,
          pendingAttemptNeedsReplayCheck: c.CheckoutAttempt.length === 1,
        };
      }
    } else if (mode === 'recover') {
      const saved = load(),
        responses = [];
      for (const index of [0, 1, 0])
        responses.push(
          await request(
            index,
            saved.f.path,
            'POST',
            saved.f.body,
            { ...saved.f.auth, 'Idempotency-Key': saved.f.key },
            45000,
            'same-key recovery',
          ),
        );
      assert(
        responses.every(
          (value) => value.record.outcome === 'http_response' && value.record.status === 201,
        ),
      );
      for (const value of responses)
        assert.deepStrictEqual(value.body.data, responses[0].body.data);
      const recovered = await snapshot('recovered');
      const checks = invariant(recovered, 1);
      await connectReadOnly();
      await F.createCartWithItems(saved.f.user._id, [
        { productId: saved.f.product._id, quantity: 1 },
      ]);
      await mongoose.disconnect();
      const fresh = await request(
        1,
        saved.f.path,
        'POST',
        saved.f.body,
        { ...saved.f.auth, 'Idempotency-Key': saved.newKey },
        45000,
        'new-key normal service',
      );
      assert.equal(fresh.record.status, 201);
      assert.notDeepStrictEqual(fresh.body.data, responses[0].body.data);
      const replay = await request(
        0,
        saved.f.path,
        'POST',
        saved.f.body,
        { ...saved.f.auth, 'Idempotency-Key': saved.f.key },
        45000,
        'old-key after new purchase',
      );
      assert.equal(replay.record.status, 201);
      assert.deepStrictEqual(replay.body.data, responses[0].body.data);
      const normal = await snapshot('normal');
      const normalChecks = invariant(normal, 2);
      result = {
        ...result,
        snapshots: [recovered, normal],
        checks,
        normalChecks,
        sameBody: true,
        sameKeyReplay: true,
        newKeyServed: true,
      };
    } else throw Error('Unknown diagnostic mode');
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.errorType = error.name;
    result.errorCode = error.code;
    if (error.name === 'AssertionError') result.invariantFailure = true;
  } finally {
    await A.db.closeDatabase();
    fs.writeFileSync('/fixture/result-' + mode + '.json', JSON.stringify(result));
    console.log('MONGO_EVIDENCE_RESULT=' + JSON.stringify(result));
  }
}
module.exports = { request, snapshot, invariant, load, hash };
if (require.main === module)
  main().catch(() => {
    console.log(
      'MONGO_EVIDENCE_RESULT=' + JSON.stringify({ passed: false, stage: 'diagnostic-cleanup' }),
    );
    process.exitCode = 1;
  });
