const { fork, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const mongoose = require('mongoose');
const { createClient } = require('redis');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser, signToken } = require('./helpers/factories');
const uri = process.env.TEST_REDIS_URL;
if (process.env.CI && !uri) throw new Error('CI requires real TEST_REDIS_URL');
const poll = async (fn, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Condition deadline exceeded');
};
(uri ? describe : describe.skip)('two backend processes over HTTP with real Redis', () => {
  let children = [], urls = [], client, namespace;
  beforeAll(async () => {
    if (!/^redis:\/\/(127\.0\.0\.1|localhost):\d+$/.test(uri)) throw new Error('Local test Redis required');
    if (process.env.TEST_MONGODB_URI) throw new Error('Crash drill requires its own disposable Mongo process, unset TEST_MONGODB_URI');
    await connect({mongoArgs:['--setParameter','transactionLifetimeLimitSeconds=5']}); namespace = 'totmart:test:http:' + randomUUID();
    client = createClient({ url: uri }); client.on('error', () => {}); await client.connect();
    for (let i = 0; i < 2; i++) {
      const child = fork(require.resolve('./helpers/http-process'), [], { env: { ...process.env, MONGODB_URI: mongoose.connection.getClient().s.url, REDIS_URL: uri, REDIS_NAMESPACE: namespace, LOG_LEVEL: 'silent' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      children.push(child);
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Child startup deadline')), 20000);
        child.once('message', data => { clearTimeout(timer); resolve(data.port); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('Child exited: ' + code)); });
      });
      urls.push('http://127.0.0.1:' + port);
    }
  });
  afterAll(async () => {
    for (const child of children) if (child.connected) {
      await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.send('stop'); });
    }
    if (client?.isReady) { const keys = []; for await (const batch of client.scanIterator({ MATCH: namespace + ':*' })) keys.push(...batch); if (keys.length) await client.del(keys); }
    if (client?.isOpen) client.destroy(); await clearDatabase(); await closeDatabase();
  });
  const call = async (index, path, user, method = 'GET') => {
    const response = await fetch(urls[index] + path, { method, headers: { Authorization: 'Bearer ' + signToken(user) }, signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  test('attempt user quota spans both processes; a different user retains recovery budget', async () => {
    const { user } = await createUser(), { user: other } = await createUser();
    const path = '/api/checkout/attempts/products/unknown-reference-1234'; // Invalid reference still costs quota.
    for (let i = 0; i < 120; i++) expect((await call(i % 2, path, user)).status).toBe(400);
    expect((await call(0, path, user)).status).toBe(429);
    expect((await call(1, path, other)).status).toBe(400);
  });
  test('shared IP quota blocks rotating accounts across both processes', async () => {
    const resetIp = async () => { const keys=[];for await(const batch of client.scanIterator({MATCH:namespace+':limit:attempt-ip:*'}))keys.push(...batch);if(keys.length)await client.del(keys); };
    await resetIp();
    try {
      for(let account=0;account<3;account++) {
        const {user}=await createUser();
        for(let i=0;i<100;i++) expect((await call(i%2,'/api/checkout/attempts/products/ip-quota-reference-1234',user)).status).toBe(400);
      }
      const {user}=await createUser();expect((await call(1,'/api/checkout/attempts/products/ip-quota-reference-1234',user)).status).toBe(429);
    } finally { await resetIp(); }
  });
  const exerciseLogout = async () => {
    const { user } = await createUser({ role: 'admin' });
    const Session = require('../src/models/AuthSession');
    const sid = randomUUID(); await Session.create({ userId: user._id, sessionId: sid, refreshHash: randomUUID(), tokenVersion: 0, expiresAt: new Date(Date.now() + 60000) });
    const token = require('jsonwebtoken').sign({ userId: String(user._id), sid, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = { Authorization: 'Bearer ' + token };
    const ticketResponse = await fetch(urls[1] + '/api/admin/notifications/stream-ticket', { headers });
    expect(ticketResponse.status).toBe(200); const ticket = (await ticketResponse.json()).data.ticket;
    let closed = false;
    const stream = http.get(urls[1] + '/api/admin/notifications/stream?ticket=' + ticket);
    await new Promise((resolve, reject) => { stream.once('response', response => { expect(response.statusCode).toBe(200); response.on('data', () => {}); response.once('end', () => { closed = true; }); resolve(); }); stream.once('error', reject); });
    try {
      expect(closed).toBe(false);
      expect((await fetch(urls[0] + '/api/home/logout', { method: 'POST', headers })).status).toBe(200);
      expect((await fetch(urls[1] + '/api/users/me', { headers })).status).toBe(401);
      await poll(() => closed);
      await poll(async () => await require('../src/models/SecurityOutbox').countDocuments({ userId: user._id, state: 'published' }) === 1);
      expect(await require('../src/models/SecurityOutbox').countDocuments({ userId: user._id, state: 'published' })).toBe(1);
    } finally { stream.destroy(); }
  };
  test('HTTP logout revokes session on the other process and closes its stream through the real worker/subscriber', exerciseLogout);
  test('account lock is enforced across processes', async () => {
    const { user: admin } = await createUser({ role: 'admin' }), { user } = await createUser();
    expect((await call(0, '/api/users/lock-user/' + user._id, admin, 'DELETE')).status).toBe(200);
    expect((await call(1, '/api/users/me', user)).status).toBe(403);
  });
  test('owned Redis outage fails readiness and limiter closed, then reconnects and drains revocation backlog', async () => {
    const container = process.env.TEST_REDIS_CONTAINER;
    if (!/^totmart-session-[a-z0-9-]+-redis$/.test(container || '')) throw new Error('Set TEST_REDIS_CONTAINER to the Redis created for this drill');
    const { user } = await createUser();
    try {
      execFileSync('docker', ['stop', container], { timeout: 20000, stdio: 'ignore' });
      await poll(async () => (await call(0, '/api/home/health', user)).status === 503);
      expect((await call(1, '/api/checkout/attempts/products/unknown-reference-1234', user)).status).toBe(503);
      await require('../src/services/securityRevocationService').revoke({ userId: user._id, reason: 'outage-drill' });
      expect(await require('../src/models/SecurityOutbox').countDocuments({ userId: user._id, state: 'pending' })).toBe(1);
    } finally { execFileSync('docker', ['start', container], { timeout: 20000, stdio: 'ignore' }); }
    await poll(async () => (await call(0, '/api/home/health', user)).status === 200, 25000);
    await poll(async () => await require('../src/models/SecurityOutbox').countDocuments({ userId: user._id, state: 'published' }) === 1, 25000);
    expect((await call(1, '/api/users/me', user)).status).toBe(401);
  });
  test('subscriber receives revocation again after Redis recovery', exerciseLogout);
  test('Redis accepts TCP but stops responding: HTTP limiter has a bounded fail-closed deadline', async () => {
    const container = process.env.TEST_REDIS_CONTAINER;
    if (!/^totmart-session-[a-z0-9-]+-redis$/.test(container || '')) throw new Error('Owned Redis required');
    const { user } = await createUser();
    try {
      execFileSync('docker', ['pause', container], { timeout: 10000, stdio: 'ignore' });
      expect((await call(0, '/api/checkout/attempts/products/unknown-reference-1234', user)).status).toBe(503);
      await poll(async () => (await call(1, '/api/home/health', user)).status === 503);
    } finally { execFileSync('docker', ['unpause', container], { timeout: 10000, stdio: 'ignore' }); }
    await poll(async () => (await call(1, '/api/home/health', user)).status === 200, 25000);
  });
  test('abrupt process death during an HTTP create is recoverable through the surviving process', async () => {
    // The disposable server expires abandoned transactions after 5s (production default is 60s).
    // This is an explicit drill parameter, not a claim of a 15s production recovery deadline.
    const {createBrand,createProduct,createCartWithItems,createCoupon}=require('./helpers/factories');
    const {user}=await createUser(), product=await createProduct(await createBrand()), coupon=await createCoupon();
    await createCartWithItems(user._id,[{productId:product._id,quantity:1}]);
    const body={addressId:String(user.addresses[0]._id),paymentMethod:'cod',couponCode:coupon.code}, key='process-death-reference-1234';
    const headers={Authorization:'Bearer '+signToken(user),'Content-Type':'application/json','Idempotency-Key':key};
    expect((await fetch(urls[1]+'/api/checkout/attempts/products/prepare',{method:'POST',headers,body:JSON.stringify(body)})).status).toBe(200);
    const armed=new Promise(resolve=>children[0].once('message',resolve));children[0].send('arm-crash-fence');expect(await armed).toBe('crash-fence-armed');
    const locked=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fence deadline')),5000);children[0].once('message',message=>{clearTimeout(timer);resolve(message);});});
    const creation=fetch(urls[0]+'/api/checkout/check-out',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)}).then(r=>r.status,()=>null);
    expect(await locked).toBe('transaction-fence-held');
    await new Promise(resolve=>{children[0].once('exit',resolve);children[0].kill('SIGKILL');});
    await creation;
    const ended=await fetch(urls[1]+`/api/checkout/attempts/products/${key}/terminate-with-body`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    expect(ended.status).toBe(200);const data=(await ended.json()).data;
    const created=data.state==='created';expect(['created','invalidated']).toContain(data.state);expect(data.canRestart).toBe(!created);
    expect(await require('../src/models/Order').countDocuments({userId:user._id})).toBe(created?1:0);
    expect(await require('../src/models/Checkout').countDocuments({userId:user._id})).toBe(created?1:0);
    expect((await require('../src/models/Product').findById(product._id)).stock).toBe(created?9:10);
    expect((await require('../src/models/Coupon').findById(coupon._id)).usedCount).toBe(created?1:0);
    expect(await require('../src/models/CheckoutAttempt').countDocuments({userId:user._id,state:data.state})).toBe(1);
    expect(data.state).toBe('invalidated'); // Killed at a known pre-commit barrier.
    // This proves recovery of an abandoned transaction, not a lost Mongo commit acknowledgement.
  });
});
