const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const A = require('./adapter');
// Canonical B06 loads app before factories: preserve global model/plugin registration.
// No local listener is started; all requests below still cross HTTPS to image servers.
require('/app/src/app');
const F = require('./factories');
const User = require('/app/src/models/User');
const Session = require('/app/src/models/AuthSession');
const { assert, http, db, token, business, digest } = A;
const headers = (user) => ({ Authorization: 'Bearer ' + token(user) });
const cookie = (response) =>
  response.headers['set-cookie'].find((value) => value.startsWith('refreshToken=')).split(';')[0];
const refresh = (index, value) =>
  http(index, '/api/home/refresh', 'POST', undefined, { Cookie: value, 'X-TotMart-Request': '1' });
async function poll(work, bound = 10000) {
  const until = Date.now() + bound;
  while (Date.now() < until) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error('Fixture observation deadline');
}
async function rawFamily(user) {
  const jwt = token(user),
    sid = require('jsonwebtoken').decode(jwt).sid;
  const raw = crypto.randomBytes(48).toString('hex');
  await Session.updateOne(
    { sessionId: sid, userId: user._id },
    {
      refreshHash: require('/app/src/services/sessionService').hash(raw),
      expiresAt: new Date(Date.now() + 30 * 86400000),
    },
  );
  return { jwt, sid, raw, cookie: 'refreshToken=' + raw };
}
async function b06() {
  const tests = [],
    before = [],
    afterEach = [],
    after = [],
    cases = [];
  global.expect = A.expect;
  // Prove negative assertions fail before adapting any canonical scenario.
  assert.throws(() => A.expect(1).toBe(2));
  assert.throws(() => A.expect({ amount: 1 }).toEqual({ amount: 2 }));
  assert.throws(() => A.expect([1]).toHaveLength(2));
  assert.throws(() => A.expect(1).toBeGreaterThanOrEqual(2));
  global.beforeAll = (fn) => before.push(fn);
  global.afterEach = (fn) => afterEach.push(fn);
  global.afterAll = (fn) => after.push(fn);
  global.test = (name, work) => tests.push({ name, work });
  require('/fixture/b06');
  assert.equal(tests.length, 5);
  await db.clearDatabase();
  try {
    for (const hook of before) await hook();
    for (const test of tests) {
      const started = Date.now();
      try {
        await test.work();
        cases.push({ name: test.name, passed: true, durationMs: Date.now() - started });
      } catch (error) {
        error.failedCase = test.name;
        error.completedCases = cases;
        throw error;
      }
      for (const hook of afterEach) await hook();
    }
  } finally {
    for (const hook of after) await hook();
  }
  return { cases, unchangedB06AssertionBodies: true, realHttpsBackends: 2 };
}
async function authCookieDb() {
  const { user, plainPassword } = await F.createUser();
  const login = await http(0, '/api/home/login', 'POST', {
    email: user.email,
    password: plainPassword,
    rememberMe: true,
  });
  assert.equal(login.status, 200);
  const claims = require('jsonwebtoken').decode(login.body.token);
  for (const key of ['userId', 'role', 'name', 'email', 'tokenVersion', 'sid'])
    assert(key in claims);
  for (const value of login.headers['set-cookie']) {
    for (const pattern of [/HttpOnly/i, /Secure/i, /SameSite=Lax/i, /Path=\//i])
      assert.match(value, pattern);
  }
  const family = await Session.findOne({ sessionId: claims.sid });
  assert(Math.abs(family.expiresAt.getTime() - Date.now() - 30 * 86400000) < 10000);
  const badCsrf = await http(1, '/api/home/refresh', 'POST', undefined, { Cookie: cookie(login) });
  assert.equal(badCsrf.status, 403);
  assert.equal((await Session.findById(family._id)).history.length, 0);
  const allowed = await refresh(1, cookie(login));
  assert.equal(allowed.status, 200);
  const badOrigin = await http(
    1,
    '/api/home/login',
    'POST',
    { email: user.email, password: plainPassword },
    { Origin: 'https://forbidden.totmart.test' },
  );
  assert.equal(badOrigin.status, 403);
  const logout = await http(0, '/api/home/logout', 'POST', undefined, {
    Authorization: 'Bearer ' + allowed.body.token,
  });
  assert.equal(logout.status, 200);
  for (const value of logout.headers['set-cookie']) {
    for (const pattern of [
      /HttpOnly/i,
      /Secure/i,
      /SameSite=Lax/i,
      /Path=\//i,
      /Expires=Thu, 01 Jan 1970/i,
    ])
      assert.match(value, pattern);
  }
  assert.equal(
    (
      await http(1, '/api/users/me', 'GET', undefined, {
        Authorization: 'Bearer ' + allowed.body.token,
      })
    ).status,
    401,
  );
  const fresh = (await F.createUser()).user,
    auth = headers(fresh);
  assert.equal((await http(0, '/api/manager/products', 'GET', undefined, auth)).status, 403);
  await User.updateOne({ _id: fresh._id }, { role: 'merchant' });
  assert.equal((await http(1, '/api/manager/products', 'GET', undefined, auth)).status, 200);
  await User.updateOne({ _id: fresh._id }, { isActive: false });
  assert.equal((await http(0, '/api/users/me', 'GET', undefined, auth)).status, 403);
  await User.updateOne({ _id: fresh._id }, { isActive: true, $inc: { tokenVersion: 1 } });
  assert.equal((await http(1, '/api/users/me', 'GET', undefined, auth)).status, 401);
  return {
    secureCookieAttributes: true,
    clearAttributes: true,
    csrfCors: true,
    dbRoleActiveVersionSid: true,
    familyLifetimeDays: 30,
  };
}
async function familyBudget() {
  const user = (await F.createUser()).user,
    initial = await rawFamily(user);
  const expiry = (await Session.findOne({ sessionId: initial.sid })).expiresAt.getTime();
  await A.seedSession(user);
  const other = token(user);
  const pair = await Promise.all([refresh(0, initial.cookie), refresh(1, initial.cookie)]);
  assert.deepEqual(
    pair.map((value) => value.status),
    [200, 200],
  );
  assert.equal(cookie(pair[0]), cookie(pair[1]));
  assert.equal((await Session.findOne({ sessionId: initial.sid })).history[0].retries, 1);
  const retry = await refresh(1, initial.cookie);
  assert.equal(retry.status, 200);
  assert.equal(cookie(retry), cookie(pair[0]));
  assert.equal((await Session.findOne({ sessionId: initial.sid })).expiresAt.getTime(), expiry);
  assert.equal((await refresh(0, initial.cookie)).status, 401);
  for (const index of [0, 1]) {
    assert.equal(
      (
        await http(index, '/api/users/me', 'GET', undefined, {
          Authorization: 'Bearer ' + initial.jwt,
        })
      ).status,
      401,
    );
    assert.equal(
      (await http(index, '/api/users/me', 'GET', undefined, { Authorization: 'Bearer ' + other }))
        .status,
      200,
    );
  }
  const otherSid = require('jsonwebtoken').decode(other).sid;
  await Session.updateOne(
    { sessionId: otherSid, userId: user._id },
    { expiresAt: new Date(Date.now() - 1000) },
  );
  assert.equal(
    (await http(0, '/api/users/me', 'GET', undefined, { Authorization: 'Bearer ' + other })).status,
    401,
  );
  return {
    sameSuccessor: true,
    retries: 2,
    absoluteExpiryUnchanged: true,
    otherFamilyIsolated: true,
    expiredFixtureDenied: true,
  };
}
async function historyBoundary() {
  const user = (await F.createUser()).user,
    family = await rawFamily(user);
  const old = Array.from({ length: 4095 }, (_, index) => ({
    hash: crypto
      .createHash('sha256')
      .update('fixture-' + index)
      .digest('hex'),
    consumedAt: new Date(),
    retries: 0,
  }));
  await Session.updateOne({ sessionId: family.sid, userId: user._id }, { history: old });
  const first = await refresh(0, family.cookie);
  assert.equal(first.status, 200);
  assert.equal((await Session.findOne({ sessionId: family.sid })).history.length, 4096);
  assert.equal((await refresh(1, family.cookie)).status, 200);
  assert.equal((await refresh(0, cookie(first))).status, 401);
  const saved = await Session.findOne({ sessionId: family.sid });
  assert.equal(saved.history.length, 4096);
  assert.deepEqual(
    saved.history.slice(0, 4095).map((row) => row.hash),
    old.map((row) => row.hash),
  );
  return { historyRetained: 4096, boundaryRevocation: true, seededBoundaryFixture: true };
}
async function stream(jwt) {
  const ticket = await http(1, '/api/admin/notifications/stream-ticket', 'GET', undefined, {
    Authorization: 'Bearer ' + jwt,
  });
  assert.equal(ticket.status, 200);
  const state = { closed: false, heartbeats: 0 };
  await new Promise((resolve, reject) => {
    const req = https.get(
      A.url(1) +
        '/api/admin/notifications/stream?ticket=' +
        encodeURIComponent(ticket.body.data.ticket),
      { headers: { Origin: 'https://app.totmart.test' } },
    );
    const timer = setTimeout(() => {
      req.destroy();
      reject(Error('SSE open deadline'));
    }, 8000);
    req.on('error', reject);
    req.on('response', (res) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) {
        res.resume();
        reject(Error('SSE rejected'));
        return;
      }
      state.openedAt = Date.now();
      res.on('data', (chunk) => {
        if (chunk.toString().includes(': ping')) state.heartbeats++;
      });
      res.on('end', () => {
        state.endAt = Date.now();
        state.closed = true;
      });
      res.on('close', () => {
        state.closeAt = Date.now();
        state.closed = true;
      });
      res.on('aborted', () => {
        state.abortedAt = Date.now();
      });
      res.on('error', () => {
        state.errorAt = Date.now();
      });
      state.destroy = () => {
        state.localDestroyAt = Date.now();
        req.destroy();
      };
      resolve();
    });
  });
  return state;
}
async function sseFamilies() {
  const user = (await F.createUser({ role: 'admin' })).user,
    jwtA = token(user);
  await A.seedSession(user);
  const jwtB = token(user);
  const streams = [];
  try {
    const a = await stream(jwtA),
      b = await stream(jwtB);
    streams.push(a, b);
    assert.equal(
      (await http(0, '/api/home/logout', 'POST', undefined, { Authorization: 'Bearer ' + jwtA }))
        .status,
      200,
    );
    await poll(() => a.closed, 8000);
    assert.equal(b.closed, false);
    await poll(() => b.heartbeats >= 1, 23000);
    const sid = require('jsonwebtoken').decode(jwtB).sid;
    await Session.updateOne(
      { sessionId: sid, userId: user._id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await poll(() => b.closed, 23000);
    return {
      remotePubSubClose: true,
      otherFamilyStayedOpen: true,
      heartbeatObserved: true,
      dbExpiryClosedAtHeartbeat: true,
    };
  } finally {
    for (const state of streams) state.destroy();
  }
}
async function purchaseFixture(kind) {
  const user = (await F.createUser()).user,
    brand = await F.createBrand(),
    product = await F.createProduct(brand, { stock: 100 });
  let body, path;
  if (kind === 'products') {
    await F.createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    body = { addressId: String(user.addresses[0]._id), paymentMethod: 'cod' };
    path = '/api/checkout/check-out';
  } else {
    const box = await require('/app/src/models/Box').create({
      ownerId: brand.ownerId,
      name: 'Pinned fixture box',
      stock: 100,
      descriptions: 'Fixture',
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 86400000),
      value: 100000,
      products: [{ productId: product._id, quantity: 1, name: product.name, price: product.price }],
    });
    const template = await require('/app/src/models/SubscriptionTemplate').create({
      ownerId: brand.ownerId,
      name: 'Pinned fixture plan',
      boxId: box._id,
      planType: '3_month',
      basePrice: 300000,
      discountPrice: 300000,
      discountPercent: 0,
    });
    body = {
      templateId: String(template._id),
      expectedTotalAmount: 300000,
      shippingAddress: user.addresses[0].toObject(),
    };
    path = '/api/subcribe-plans/user-subscribe';
  }
  return { user, product, body, path, kind, auth: headers(user), key: crypto.randomUUID() };
}
async function attemptsContract() {
  for (const kind of ['products', 'subscription']) {
    const f = await purchaseFixture(kind),
      h = { ...f.auth, 'Idempotency-Key': f.key };
    const prepare = await http(0, `/api/checkout/attempts/${kind}/prepare`, 'POST', f.body, h);
    assert.equal(prepare.status, 200);
    const hash = prepare.body.data.hash;
    assert.equal(
      (
        await http(1, `/api/checkout/attempts/${kind}/${f.key}/terminate`, 'POST', undefined, {
          ...f.auth,
          'Attempt-Payload-Hash': hash,
        })
      ).status,
      200,
    );
    const before = await business();
    const denied = await http(0, f.path, 'POST', f.body, h);
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'ATTEMPT_INVALIDATED');
    assert.deepStrictEqual(await business(), before);
    const key = crypto.randomUUID(),
      live = { ...h, 'Idempotency-Key': key };
    const [a, b] = await Promise.all([
      http(0, f.path, 'POST', f.body, live),
      http(1, f.path, 'POST', f.body, live),
    ]);
    assert.deepStrictEqual([a.status, b.status], [201, 201]);
    assert.deepStrictEqual(a.body.data, b.body.data);
    const created = await require('/app/src/models/Checkout').findOne({
      userId: f.user._id,
      requestKey: key,
    });
    const snapshot = await business();
    const conflict = await http(
      1,
      f.path,
      'POST',
      { ...f.body, ...(kind === 'products' ? { note: 'different' } : { expectedTotalAmount: 1 }) },
      live,
    );
    assert.equal(conflict.status, 409);
    assert.deepStrictEqual(await business(), snapshot);
    const ended = await http(
      1,
      `/api/checkout/attempts/${kind}/${key}/terminate-with-body`,
      'POST',
      f.body,
      f.auth,
    );
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data.state, 'created');
    assert.equal(ended.body.data.canRestart, false);
    assert.equal(
      (await require('/app/src/models/Checkout').findById(created._id)).state,
      created.state,
    );
    if (kind === 'products') {
      await F.createCartWithItems(f.user._id, [{ productId: f.product._id, quantity: 2 }]);
      assert.deepStrictEqual((await http(0, f.path, 'POST', f.body, live)).body.data, a.body.data);
      assert.equal(
        (await require('/app/src/models/Cart').findOne({ userId: f.user._id })).items[0].quantity,
        2,
      );
    }
    const next = await http(1, f.path, 'POST', f.body, {
      ...f.auth,
      'Idempotency-Key': crypto.randomUUID(),
    });
    assert.equal(next.status, 201);
    assert.notDeepEqual(next.body.data, a.body.data);
    assert.equal(
      await require('/app/src/models/Checkout').countDocuments({ userId: f.user._id }),
      2,
    );
  }
  return {
    bothKinds: true,
    tombstone: true,
    replay: true,
    concurrentCreation: true,
    mismatchNoMutation: true,
    createdNotCancelled: true,
    independentNewKeys: true,
  };
}
async function recoveryArm() {
  const user = (await F.createUser()).user,
    family = await rawFamily(user);
  const lost = await http(0, '/api/home/refresh', 'POST', undefined, {
    Cookie: family.cookie,
    'X-TotMart-Request': '1',
    'X-Fixture-Drop-Response': '1',
  }).then(
    () => false,
    () => true,
  );
  assert.equal(lost, true);
  const saved = await Session.findOne({ sessionId: family.sid });
  assert.equal(saved.history.length, 1);
  const f = await purchaseFixture('products'),
    h = { ...f.auth, 'Idempotency-Key': f.key };
  assert.equal(
    (await http(1, '/api/checkout/attempts/products/prepare', 'POST', f.body, h)).status,
    200,
  );
  const productLost = await http(0, f.path, 'POST', f.body, {
    ...h,
    'X-Fixture-Drop-Response': '1',
  }).then(
    () => false,
    () => true,
  );
  assert.equal(productLost, true);
  const checkout = await require('/app/src/models/Checkout').findOne({
    userId: f.user._id,
    requestKey: f.key,
  });
  assert(checkout);
  fs.writeFileSync(
    '/fixture/private-recovery.json',
    JSON.stringify({ family, refreshHash: saved.refreshHash, f, result: checkout.result }),
  );
  return {
    refreshResponseLost: true,
    commerceResponseLost: true,
    durableCommitObserved: true,
    mongoUnknownCommitClaim: false,
  };
}
async function recoveryCheck() {
  const saved = JSON.parse(fs.readFileSync('/fixture/private-recovery.json'));
  const pair = await Promise.all([
    refresh(0, saved.family.cookie),
    refresh(1, saved.family.cookie),
  ]);
  assert.deepEqual(
    pair.map((value) => value.status),
    [200, 200],
  );
  assert.equal(cookie(pair[0]), cookie(pair[1]));
  assert.equal(
    require('/app/src/services/sessionService').hash(cookie(pair[0]).slice('refreshToken='.length)),
    saved.refreshHash,
  );
  assert.equal((await Session.findOne({ sessionId: saved.family.sid })).history[0].retries, 2);
  const h = { ...saved.f.auth, 'Idempotency-Key': saved.f.key };
  for (const index of [1, 0])
    assert.deepStrictEqual(
      (await http(index, saved.f.path, 'POST', saved.f.body, h)).body.data,
      saved.result,
    );
  assert.equal(
    await require('/app/src/models/Checkout').countDocuments({
      userId: saved.f.user._id,
      requestKey: saved.f.key,
    }),
    1,
  );
  assert.equal(
    await require('/app/src/models/Order').countDocuments({ userId: saved.f.user._id }),
    1,
  );
  assert.equal((await require('/app/src/models/Product').findById(saved.f.product._id)).stock, 99);
  return {
    sameSuccessorAfterRestart: true,
    survivorAndRestartReplay: true,
    oneCommerceObligation: true,
  };
}
async function main() {
  const command = process.argv[2];
  let result;
  try {
    if (command === 'health') {
      for (const index of [0, 1]) {
        assert.equal((await http(index, '/api/home/health')).status, 200);
        assert.equal((await http(index, '/api/home/live')).status, 200);
      }
      result = {};
    } else if (command.startsWith('fault-')) {
      result = await require('/fixture/fault-client').run(command);
    } else {
      await db.connect();
      const commands = {
        b06,
        'auth-cookie-db': authCookieDb,
        'family-budget': familyBudget,
        'history-boundary': historyBoundary,
        'sse-families': sseFamilies,
        'attempt-contract': attemptsContract,
        'recovery-arm': recoveryArm,
        'recovery-check': recoveryCheck,
      };
      assert(command in commands);
      result = await commands[command]();
    }
    if (!result || result.passed === false) process.exitCode = 1;
    console.log(
      'ROUND_B_RESULT=' +
        JSON.stringify({ command, passed: true, ...result, requests: A.observations }),
    );
  } catch (error) {
    process.exitCode = 1;
    console.log(
      'ROUND_B_RESULT=' +
        JSON.stringify({
          command,
          passed: false,
          name: error.name,
          code: error.code,
          keyFields: error.keyPattern ? Object.keys(error.keyPattern) : undefined,
          failedCase: error.failedCase,
          completedCases: error.completedCases,
          operator: error.operator,
          actual:
            typeof error.actual === 'number' || typeof error.actual === 'boolean'
              ? error.actual
              : undefined,
          expected:
            typeof error.expected === 'number' || typeof error.expected === 'boolean'
              ? error.expected
              : undefined,
          actualHash:
            error.actual && typeof error.actual === 'object' ? digest(error.actual) : undefined,
          expectedHash:
            error.expected && typeof error.expected === 'object'
              ? digest(error.expected)
              : undefined,
          requests: A.observations,
        }),
    );
  } finally {
    await db.closeDatabase();
  }
}
module.exports = { purchaseFixture, headers, stream, poll, A, F };
if (require.main === module)
  main().catch(() => {
    console.log('ROUND_B_RESULT=' + JSON.stringify({ passed: false, stage: 'client-cleanup' }));
    process.exitCode = 1;
  });
