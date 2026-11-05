const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { writeFileSync } = require('node:fs');
const mongoose = require('mongoose');
const { createClient } = require('redis');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken } = require('./helpers/factories');
const { localRedisUrl } = require('./helpers/localRedisUrl');
const { disposableRedis } = require('./helpers/disposableRedis');
const uri = process.env.TEST_REDIS_URL;
if (process.env.CI && !uri) throw new Error('CI requires real TEST_REDIS_URL');
const poll = async (fn, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Condition deadline exceeded');
};
(uri ? describe : describe.skip)('two backend processes over HTTP with real Redis', () => {
  let children = [],
    urls = [],
    client,
    observer,
    namespace,
    ownedRedis,
    dbConnected = false;
  beforeAll(async () => {
    const { database } = localRedisUrl(uri);
    if (process.env.TEST_MONGODB_URI)
      throw new Error(
        'Crash drill requires its own disposable Mongo process, unset TEST_MONGODB_URI',
      );
    ownedRedis = await disposableRedis({
      database,
      onEvidence: (evidence) => {
        if (process.env.B01_HTTP_RESOURCE_FILE)
          writeFileSync(process.env.B01_HTTP_RESOURCE_FILE, JSON.stringify(evidence) + '\n');
      },
    });
    observer = createClient({
      url: uri,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    observer.on('error', () => {});
    await observer.connect();
    expect(localRedisUrl(ownedRedis.url).port).not.toBe(localRedisUrl(uri).port);
    await connect({ mongoArgs: ['--setParameter', 'transactionLifetimeLimitSeconds=5'] });
    dbConnected = true;
    namespace = 'totmart:test:http:' + randomUUID();
    client = createClient({
      url: ownedRedis.url,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    client.on('error', () => {});
    await client.connect();
    for (let i = 0; i < 2; i++) await startBackend(i);
  }, 120000);
  async function startBackend(index) {
    const child = fork(require.resolve('./helpers/http-process'), [], {
      env: {
        ...process.env,
        MONGODB_URI: mongoose.connection.getClient().s.url,
        REDIS_URL: ownedRedis.url,
        REDIS_NAMESPACE: namespace,
        LOG_LEVEL: 'silent',
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    children[index] = child;
    const port = await new Promise((resolve, reject) => {
      let stage = 'spawn';
      const finish = (error, value) => {
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        error ? reject(error) : resolve(value);
      };
      const onMessage = (data) => {
        if (['modules', 'mongo', 'redis'].includes(data?.startupStage)) stage = data.startupStage;
        else if (['modules', 'mongo', 'redis'].includes(data?.startupFailed))
          finish(new Error('Child startup failed at ' + data.startupFailed));
        else if (Number.isInteger(data?.port)) finish(null, data.port);
      };
      const onExit = (code) => finish(new Error('Child exited during ' + stage + ': ' + code));
      const onError = () => finish(new Error('Child spawn failed'));
      const timer = setTimeout(
        () => finish(new Error('Child startup deadline at ' + stage)),
        20000,
      );
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onError);
    });
    urls[index] = 'http://127.0.0.1:' + port;
  }
  afterAll(async () => {
    // No Redis commands during teardown: a failed outage/setup may leave it
    // unavailable. Removing this suite's owned container discards its keys.
    try {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise((resolve) => {
            const timer = setTimeout(() => {
              child.kill('SIGKILL');
              resolve();
            }, 5000);
            child.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            if (child.connected) child.send('stop');
            else child.kill('SIGKILL');
          });
        }
    } finally {
      if (client?.isOpen) client.destroy();
      if (observer?.isOpen) observer.destroy();
      try {
        if (dbConnected) await clearDatabase();
      } finally {
        try {
          await closeDatabase();
        } finally {
          ownedRedis?.cleanup();
        }
      }
    }
  });
  const call = async (index, path, user, method = 'GET') => {
    const response = await fetch(urls[index] + path, {
      method,
      headers: { Authorization: 'Bearer ' + signToken(user) },
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  };
  const b04Evidence = [];
  function recordB04(scenario, values = {}) {
    b04Evidence.push({ scenario, ...values });
    if (process.env.B01_HTTP_RESOURCE_FILE)
      writeFileSync(
        require('path').join(
          require('path').dirname(process.env.B01_HTTP_RESOURCE_FILE),
          'b04-http-evidence.json',
        ),
        JSON.stringify(b04Evidence, null, 2) + '\n',
      );
  }
  const refreshCookie = (response) =>
    response.headers
      .getSetCookie()
      .find((value) => value.startsWith('refreshToken='))
      .split(';')[0];
  async function loginFamily(user, plainPassword, index = 0) {
    const response = await fetch(urls[index] + '/api/home/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: plainPassword }),
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    return { cookie: refreshCookie(response), token: (await response.json()).token };
  }
  async function rotateAt(index, cookie) {
    const response = await fetch(urls[index] + '/api/home/refresh', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-TotMart-Request': '1' },
      signal: AbortSignal.timeout(10000),
    });
    return {
      status: response.status,
      cookie: response.status === 200 ? refreshCookie(response) : null,
      body: await response.json(),
    };
  }
  const accessAt = (index, token) =>
    fetch(urls[index] + '/api/users/me', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000),
    });
  async function command(index, message, expected) {
    await new Promise((resolve, reject) => {
      const child = children[index];
      const onMessage = (value) => {
        if (value === expected) {
          clearTimeout(timer);
          child.off('message', onMessage);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        child.off('message', onMessage);
        reject(new Error('B04 fixture command deadline'));
      }, 5000);
      child.on('message', onMessage);
      child.send(message);
    });
  }
  async function streamAt(index, token) {
    const ticketResponse = await fetch(urls[index] + '/api/admin/notifications/stream-ticket', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000),
    });
    expect(ticketResponse.status).toBe(200);
    const ticket = (await ticketResponse.json()).data.ticket;
    const state = { closed: false, endedAt: null };
    const stream = http.get(urls[index] + '/api/admin/notifications/stream?ticket=' + ticket);
    state.destroy = () => stream.destroy();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error('SSE fixture open deadline'));
      }, 5000);
      stream.once('response', (response) => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('SSE fixture rejected'));
          return;
        }
        response.on('data', () => {});
        response.once('end', () => {
          state.closed = true;
          state.endedAt = Date.now();
        });
        resolve();
      });
      stream.on('error', () => {
        clearTimeout(timer);
        reject(new Error('SSE fixture transport failed'));
      });
    });
    return state;
  }
  test('B04 concurrent refresh crosses processes, junk is isolated, ancestor reuse revokes only its family', async () => {
    const { user, plainPassword } = await createUser();
    const a = await loginFamily(user, plainPassword),
      other = await loginFamily(user, plainPassword, 1);
    const [first, duplicate] = await Promise.all([rotateAt(0, a.cookie), rotateAt(1, a.cookie)]);
    expect([first.status, duplicate.status]).toEqual([200, 200]);
    expect(first.cookie === duplicate.cookie).toBe(true);
    const Session = require('../src/models/AuthSession'),
      sid = require('jsonwebtoken').decode(a.token).sid;
    expect((await Session.findOne({ sessionId: sid })).history[0].retries).toBe(1);
    for (const junk of ['refreshToken=garbage', 'refreshToken=' + 'f'.repeat(96)])
      expect((await rotateAt(1, junk)).status).toBe(401);
    expect(await Session.countDocuments({ userId: user._id, revokedAt: { $exists: true } })).toBe(
      0,
    );
    expect((await rotateAt(1, first.cookie)).status).toBe(200);
    expect((await rotateAt(0, a.cookie)).status).toBe(401);
    for (const index of [0, 1]) {
      expect((await accessAt(index, first.body.token)).status).toBe(401);
      expect((await accessAt(index, other.token)).status).toBe(200);
    }
    expect((await rotateAt(1, other.cookie)).status).toBe(200);
    recordB04('cross-process-concurrency-junk-ancestor', {
      processes: 2,
      durableRetryCount: 1,
      otherFamilyPreserved: true,
    });
  });
  test('B04 committed refresh loses HTTP response, backend dies and restarted process recovers the same successor', async () => {
    const { user, plainPassword } = await createUser();
    const initial = await loginFamily(user, plainPassword);
    await command(0, 'arm-refresh-response-loss', 'refresh-response-loss-armed');
    const started = Date.now(),
      dead = children[0];
    const notification = new Promise((resolve, reject) => {
      const onMessage = (value) => {
        if (value === 'refresh-committed-response-dropped') {
          clearTimeout(timer);
          dead.off('message', onMessage);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        dead.off('message', onMessage);
        reject(new Error('Commit notification deadline'));
      }, 5000);
      dead.on('message', onMessage);
    });
    // No body/cookies can arrive: the fixture destroys the HTTP response after commit.
    const responseLost = await rotateAt(0, initial.cookie).then(
      () => false,
      () => true,
    );
    await notification;
    expect(responseLost).toBe(true);
    const Session = require('../src/models/AuthSession'),
      sid = require('jsonwebtoken').decode(initial.token).sid;
    const committed = await Session.findOne({ sessionId: sid });
    expect(committed.history.length).toBe(1);
    await new Promise((resolve) => {
      dead.once('exit', resolve);
      dead.kill('SIGKILL');
    });
    await startBackend(0);
    expect(children[0].pid !== dead.pid).toBe(true);
    const recovered = await rotateAt(0, initial.cookie),
      survivor = await rotateAt(1, initial.cookie);
    expect([recovered.status, survivor.status]).toEqual([200, 200]);
    expect(recovered.cookie === survivor.cookie).toBe(true);
    expect(
      require('../src/services/sessionService').hash(
        recovered.cookie.slice('refreshToken='.length),
      ) === committed.refreshHash,
    ).toBe(true);
    expect((await Session.findOne({ sessionId: sid })).history[0].retries).toBe(2);
    expect((await rotateAt(1, initial.cookie)).status).toBe(401);
    recordB04('response-lost-kill-restart-recovery', {
      elapsedMs: Date.now() - started,
      pidChanged: true,
      recoveredSameSuccessor: true,
    });
  });
  test('B04 reuse closes remote family SSE by Pub/Sub, missed publication closes on DB heartbeat', async () => {
    const { user, plainPassword } = await createUser({ role: 'admin' });
    const a = await loginFamily(user, plainPassword),
      b = await loginFamily(user, plainPassword),
      c = await loginFamily(user, plainPassword);
    const streams = [];
    let workersPaused = false;
    try {
      for (const family of [a, b, c]) streams.push(await streamAt(1, family.token));
      const Session = require('../src/models/AuthSession'),
        Outbox = require('../src/models/SecurityOutbox');
      const sidA = require('jsonwebtoken').decode(a.token).sid,
        sidB = require('jsonwebtoken').decode(b.token).sid;
      await rotateAt(0, a.cookie);
      await Session.updateOne({ sessionId: sidA }, { $set: { 'history.0.retries': 2 } });
      const publishedStart = Date.now();
      expect((await rotateAt(0, a.cookie)).status).toBe(401);
      await poll(() => streams[0].closed, 8000);
      expect(streams[0].endedAt - publishedStart).toBeLessThan(8000);
      expect(streams[1].closed || streams[2].closed).toBe(false);
      expect((await accessAt(1, a.token)).status).toBe(401);
      await poll(
        async () => (await Outbox.countDocuments({ sessionId: sidA, state: 'published' })) === 1,
      );
      await rotateAt(0, b.cookie);
      await Session.updateOne({ sessionId: sidB }, { $set: { 'history.0.retries': 2 } });
      workersPaused = true;
      for (const index of [0, 1])
        await command(index, 'pause-security-worker', 'security-worker-paused');
      const heartbeatStart = Date.now();
      expect((await rotateAt(0, b.cookie)).status).toBe(401);
      expect(await Outbox.countDocuments({ sessionId: sidB, state: 'pending' })).toBe(1);
      await poll(() => streams[1].closed, 25000);
      expect(streams[1].endedAt - heartbeatStart).toBeLessThan(23000);
      expect(streams[2].closed).toBe(false);
      expect((await accessAt(0, c.token)).status).toBe(200);
      recordB04('family-sse-pubsub-and-missed-signal', {
        pubsubClosureMs: streams[0].endedAt - publishedStart,
        heartbeatClosureMs: streams[1].endedAt - heartbeatStart,
        unaffectedFamilyStreamOpen: true,
      });
    } finally {
      for (const stream of streams) stream.destroy();
      if (workersPaused)
        for (const index of [0, 1])
          await command(index, 'resume-security-worker', 'security-worker-resumed');
    }
  }, 45000);
  test('B04 Redis outage closes streams globally but DB family revocation survives recovery and preserves other access', async () => {
    const { user, plainPassword } = await createUser({ role: 'admin' });
    const a = await loginFamily(user, plainPassword),
      b = await loginFamily(user, plainPassword, 1);
    const streams = [];
    const Session = require('../src/models/AuthSession'),
      Outbox = require('../src/models/SecurityOutbox');
    const sid = require('jsonwebtoken').decode(a.token).sid;
    let outageStart, closureMs;
    try {
      streams.push(await streamAt(0, a.token), await streamAt(1, b.token));
      await rotateAt(0, a.cookie);
      await Session.updateOne({ sessionId: sid }, { $set: { 'history.0.retries': 2 } });
      outageStart = Date.now();
      ownedRedis.action('stop');
      expect(await observer.ping()).toBe('PONG');
      await poll(async () => (await call(0, '/api/home/health', user)).status === 503);
      await poll(() => streams.every((stream) => stream.closed), 25000);
      closureMs = Math.max(...streams.map((stream) => stream.endedAt - outageStart));
      expect(closureMs).toBeLessThan(23000);
      // Redis-backed HTTP refresh is fail-closed. Exercise DB revocation while delivery is unavailable.
      expect((await rotateAt(1, b.cookie)).status).toBe(503);
      expect(
        await require('../src/services/sessionService').rotate(
          a.cookie.slice('refreshToken='.length),
        ),
      ).toBeNull();
      expect(Boolean((await Session.findOne({ sessionId: sid })).revokedAt)).toBe(true);
      for (const index of [0, 1]) {
        expect((await accessAt(index, a.token)).status).toBe(401);
        expect((await accessAt(index, b.token)).status).toBe(200);
      }
      expect(await Outbox.countDocuments({ sessionId: sid, state: 'pending' })).toBe(1);
    } finally {
      for (const stream of streams) stream.destroy();
      ownedRedis.action('start');
    }
    await poll(async () => (await call(0, '/api/home/health', user)).status === 200, 25000);
    await poll(async () => (await call(1, '/api/home/health', user)).status === 200, 25000);
    // This parent observer deliberately has reconnect disabled. Reopen it after
    // our earlier outage so subsequent existing quota tests retain their fixture.
    if (!client.isOpen) await client.connect();
    expect(await client.ping()).toBe('PONG');
    await poll(
      async () => (await Outbox.countDocuments({ sessionId: sid, state: 'published' })) === 1,
      25000,
    );
    expect((await accessAt(0, a.token)).status).toBe(401);
    expect((await rotateAt(1, a.cookie)).status).toBe(401);
    expect((await accessAt(1, b.token)).status).toBe(200);
    expect((await rotateAt(0, b.cookie)).status).toBe(200);
    const reopened = await streamAt(1, b.token);
    reopened.destroy();
    recordB04('redis-outage-recovery', {
      globalStreamClosureMs: closureMs,
      revokedFamilyDeniedDuringAndAfter: true,
      otherFamilyAccessPreserved: true,
      otherFamilyStreamReopened: true,
      separateRedisPong: true,
    });
  }, 60000);
  test('attempt user quota spans both processes; a different user retains recovery budget', async () => {
    const { user } = await createUser(),
      { user: other } = await createUser();
    const path = '/api/checkout/attempts/products/unknown-reference-1234'; // Invalid reference still costs quota.
    for (let i = 0; i < 120; i++) expect((await call(i % 2, path, user)).status).toBe(400);
    expect((await call(0, path, user)).status).toBe(429);
    expect((await call(1, path, other)).status).toBe(400);
  });
  test('shared IP quota blocks rotating accounts across both processes', async () => {
    const resetIp = async () => {
      const keys = [];
      for await (const batch of client.scanIterator({ MATCH: namespace + ':limit:attempt-ip:*' }))
        keys.push(...batch);
      if (keys.length) await client.del(keys);
    };
    await resetIp();
    try {
      for (let account = 0; account < 3; account++) {
        const { user } = await createUser();
        for (let i = 0; i < 100; i++)
          expect(
            (await call(i % 2, '/api/checkout/attempts/products/ip-quota-reference-1234', user))
              .status,
          ).toBe(400);
      }
      const { user } = await createUser();
      expect(
        (await call(1, '/api/checkout/attempts/products/ip-quota-reference-1234', user)).status,
      ).toBe(429);
    } finally {
      await resetIp();
    }
  });
  const exerciseLogout = async () => {
    const { user } = await createUser({ role: 'admin' });
    const Session = require('../src/models/AuthSession');
    const sid = randomUUID();
    await Session.create({
      userId: user._id,
      sessionId: sid,
      refreshHash: randomUUID(),
      tokenVersion: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
    const token = require('jsonwebtoken').sign(
      { userId: String(user._id), sid, tokenVersion: 0 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );
    const headers = { Authorization: 'Bearer ' + token };
    const ticketResponse = await fetch(urls[1] + '/api/admin/notifications/stream-ticket', {
      headers,
    });
    expect(ticketResponse.status).toBe(200);
    const ticket = (await ticketResponse.json()).data.ticket;
    let closed = false;
    const stream = http.get(urls[1] + '/api/admin/notifications/stream?ticket=' + ticket);
    await new Promise((resolve, reject) => {
      stream.once('response', (response) => {
        expect(response.statusCode).toBe(200);
        response.on('data', () => {});
        response.once('end', () => {
          closed = true;
        });
        resolve();
      });
      stream.once('error', reject);
    });
    try {
      expect(closed).toBe(false);
      expect((await fetch(urls[0] + '/api/home/logout', { method: 'POST', headers })).status).toBe(
        200,
      );
      expect((await fetch(urls[1] + '/api/users/me', { headers })).status).toBe(401);
      await poll(() => closed);
      await poll(
        async () =>
          (await require('../src/models/SecurityOutbox').countDocuments({
            userId: user._id,
            state: 'published',
          })) === 1,
      );
      expect(
        await require('../src/models/SecurityOutbox').countDocuments({
          userId: user._id,
          state: 'published',
        }),
      ).toBe(1);
    } finally {
      stream.destroy();
    }
  };
  test(
    'HTTP logout revokes session on the other process and closes its stream through the real worker/subscriber',
    exerciseLogout,
  );
  test('account lock is enforced across processes', async () => {
    const { user: admin } = await createUser({ role: 'admin' }),
      { user } = await createUser();
    expect((await call(0, '/api/users/lock-user/' + user._id, admin, 'DELETE')).status).toBe(200);
    expect((await call(1, '/api/users/me', user)).status).toBe(403);
  });
  test('owned Redis outage fails readiness and limiter closed, then reconnects and drains revocation backlog', async () => {
    const { user } = await createUser();
    try {
      ownedRedis.action('stop');
      expect(await observer.ping()).toBe('PONG'); // Another suite's Redis is unaffected.
      await poll(async () => (await call(0, '/api/home/health', user)).status === 503);
      expect(
        (await call(1, '/api/checkout/attempts/products/unknown-reference-1234', user)).status,
      ).toBe(503);
      await require('../src/services/securityRevocationService').revoke({
        userId: user._id,
        reason: 'outage-drill',
      });
      expect(
        await require('../src/models/SecurityOutbox').countDocuments({
          userId: user._id,
          state: 'pending',
        }),
      ).toBe(1);
    } finally {
      ownedRedis.action('start');
    }
    await poll(async () => (await call(0, '/api/home/health', user)).status === 200, 25000);
    await poll(
      async () =>
        (await require('../src/models/SecurityOutbox').countDocuments({
          userId: user._id,
          state: 'published',
        })) === 1,
      25000,
    );
    expect((await call(1, '/api/users/me', user)).status).toBe(401);
  });
  test('subscriber receives revocation again after Redis recovery', exerciseLogout);
  test('Redis accepts TCP but stops responding: HTTP limiter has a bounded fail-closed deadline', async () => {
    const { user } = await createUser();
    try {
      ownedRedis.action('pause');
      expect(await observer.ping()).toBe('PONG');
      expect(
        (await call(0, '/api/checkout/attempts/products/unknown-reference-1234', user)).status,
      ).toBe(503);
      await poll(async () => (await call(1, '/api/home/health', user)).status === 503);
    } finally {
      ownedRedis.action('unpause');
    }
    await poll(async () => (await call(1, '/api/home/health', user)).status === 200, 25000);
  });
  const b06Evidence = [];
  require('./helpers/commerceHttpScenarios')({
    urls,
    children,
    startBackend,
    command,
    record: (scenario, values) => {
      b06Evidence.push({ scenario, ...values });
      if (process.env.B01_HTTP_RESOURCE_FILE)
        writeFileSync(
          require('path').join(
            require('path').dirname(process.env.B01_HTTP_RESOURCE_FILE),
            'b06-http-evidence.json',
          ),
          JSON.stringify(b06Evidence, null, 2) + '\n',
        );
    },
  });
  test('abrupt process death during an HTTP create is recoverable through the surviving process', async () => {
    // The disposable server expires abandoned transactions after 5s (production default is 60s).
    // This is an explicit drill parameter, not a claim of a 15s production recovery deadline.
    const {
      createBrand,
      createProduct,
      createCartWithItems,
      createCoupon,
    } = require('./helpers/factories');
    const { user } = await createUser(),
      product = await createProduct(await createBrand()),
      coupon = await createCoupon();
    await createCartWithItems(user._id, [{ productId: product._id, quantity: 1 }]);
    const body = {
        addressId: String(user.addresses[0]._id),
        paymentMethod: 'cod',
        couponCode: coupon.code,
      },
      key = 'process-death-reference-1234';
    const headers = {
      Authorization: 'Bearer ' + signToken(user),
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    };
    expect(
      (
        await fetch(urls[1] + '/api/checkout/attempts/products/prepare', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(200);
    const armed = new Promise((resolve) => children[0].once('message', resolve));
    children[0].send('arm-crash-fence');
    expect(await armed).toBe('crash-fence-armed');
    const locked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fence deadline')), 5000);
      children[0].once('message', (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    const creation = fetch(urls[0] + '/api/checkout/check-out', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).then(
      (r) => r.status,
      () => null,
    );
    expect(await locked).toBe('transaction-fence-held');
    await new Promise((resolve) => {
      children[0].once('exit', resolve);
      children[0].kill('SIGKILL');
    });
    await creation;
    const ended = await fetch(
      urls[1] + `/api/checkout/attempts/products/${key}/terminate-with-body`,
      { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) },
    );
    expect(ended.status).toBe(200);
    const data = (await ended.json()).data;
    const created = data.state === 'created';
    expect(['created', 'invalidated']).toContain(data.state);
    expect(data.canRestart).toBe(!created);
    expect(await require('../src/models/Order').countDocuments({ userId: user._id })).toBe(
      created ? 1 : 0,
    );
    expect(await require('../src/models/Checkout').countDocuments({ userId: user._id })).toBe(
      created ? 1 : 0,
    );
    expect((await require('../src/models/Product').findById(product._id)).stock).toBe(
      created ? 9 : 10,
    );
    expect((await require('../src/models/Coupon').findById(coupon._id)).usedCount).toBe(
      created ? 1 : 0,
    );
    expect(
      await require('../src/models/CheckoutAttempt').countDocuments({
        userId: user._id,
        state: data.state,
      }),
    ).toBe(1);
    expect(data.state).toBe('invalidated'); // Killed at a known pre-commit barrier.
    // This proves recovery of an abandoned transaction, not a lost Mongo commit acknowledgement.
  });
});
