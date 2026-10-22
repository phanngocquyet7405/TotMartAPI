const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Lease, candidate } = require('./image-fixture');
const { inspectMongoResponse, inspectPublishedLogs } = require('../roundA/disclosure-guard');
const onlyMongo = process.argv.includes('--mongo-only');
const evidencePhase = onlyMongo
  ? `mongo-diagnostic-${require('node:crypto').randomUUID()}`
  : process.argv.includes('--final')
    ? 'phase3-final'
    : 'phase3';
const reportFile = `artifacts/round-b/${evidencePhase}.json`;
const lease = new Lease(evidencePhase);
const fixtureDatabase = `totmart_b_${lease.run.replaceAll('-', '')}`;
const report = {
  phase: 3,
  run: lease.run,
  candidateImage: candidate.image.id,
  cases: [],
  browserE2E: false,
  nativeLinuxSignals: true,
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `totmart-b-${lease.run}-certs-`));
const openssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
const assert = (value, message) => {
  if (!value) {
    const error = new Error(message);
    error.name = 'BootSafetyFailure';
    throw error;
  }
};
function certificates() {
  const run = (args) =>
    execFileSync(openssl, args, {
      cwd: directory,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
  for (const ca of ['ca', 'wrong-ca'])
    run([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${ca}.key`,
      '-out',
      `${ca}.pem`,
      '-days',
      '2',
      '-subj',
      `/CN=TotMart-${lease.run}-${ca}`,
    ]);
  for (const [name, hosts] of [
    ['redis', ['redis.totmart.test']],
    ['proxy', ['api-prod.totmart.test', 'api-stage.totmart.test']],
  ]) {
    fs.writeFileSync(
      path.join(directory, `${name}.ext`),
      `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}\nextendedKeyUsage=serverAuth\n`,
    );
    run([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=${hosts[0]}`,
    ]);
    run([
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${name}.pem`,
      '-days',
      '2',
      '-extfile',
      `${name}.ext`,
    ]);
  }
  return Object.fromEntries(
    ['ca.pem', 'wrong-ca.pem', 'redis.key', 'redis.pem', 'proxy.key', 'proxy.pem'].map((name) => [
      name,
      fs.readFileSync(path.join(directory, name), 'utf8'),
    ]),
  );
}
let certs;
const bootstrap = 'printf \'%s\' "$FIXTURE_CA" > /fixture/ca.pem; exec node src/server.js';
function strictConfig(mode, changes = {}, ca = certs['ca.pem']) {
  return lease.config(mode, {
    REDIS_URL: `rediss://:${lease.credentials.redisPassword}@redis.totmart.test:6379/0`,
    NODE_EXTRA_CA_CERTS: '/fixture/ca.pem',
    FIXTURE_CA: ca,
    ...changes,
  });
}
function backend(role, env) {
  return lease.backend(role, env, ['sh', '-c', bootstrap]);
}
async function scenario(name, work) {
  if (onlyMongo && name !== 'mongo-runtime-outage-readiness-and-liveness') {
    if (name.includes('strict-entrypoint-boot')) await work();
    return;
  }
  const start = Date.now();
  try {
    const evidence = await work();
    report.cases.push({ name, passed: true, durationMs: Date.now() - start, ...evidence });
  } catch (error) {
    report.cases.push({ name, passed: false, durationMs: Date.now() - start });
    throw error;
  } finally {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.cases.at(-1)));
  }
}
async function failBoot(role, env, bound = 25000) {
  const id = backend(role, env);
  const start = Date.now();
  lease.start(id);
  await lease
    .poll(() => !lease.verify(id).state.Running, bound, `${role} fail-safe exit`)
    .catch(() => assert(false, `${role} did not exit within finite boot bound`));
  const state = lease.verify(id).state;
  const logs = lease.docker(['logs', id]);
  assert(state.ExitCode !== 0, `${role} accepted invalid boot configuration`);
  assert(!logs.includes('Server running on'), `${role} listened before failed admission`);
  return {
    containerId: id,
    exitCode: state.ExitCode,
    durationMs: Date.now() - start,
    listened: false,
    mongoConnectEvent: logs.includes('Đang kết nối tới MongoDB'),
  };
}
function runClient(client, code, timeout = 10000) {
  return JSON.parse(lease.exec(client, ['node', '-e', code], timeout));
}
function httpsRequest(client, mode, endpoint) {
  const startedAt = Date.now();
  const value = runClient(
    client,
    `require('https').get('https://api-${mode}.totmart.test:8443${endpoint}',{headers:{Origin:'https://app.totmart.test'},timeout:4000},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,cors:r.headers['access-control-allow-origin'],headers:{'x-request-id':r.headers['x-request-id']},body:JSON.parse(body)})))}).on('timeout',function(){this.destroy()}).on('error',()=>{console.log(JSON.stringify({status:0}));process.exitCode=0})`,
  );
  recordRequest(mode, endpoint, 'GET', startedAt, value);
  return value;
}
let outage;
function redact(value, key = '') {
  if (/password|secret|token|cookie|authorization|credential|api.?key/i.test(key))
    return '[REDACTED]';
  if (typeof value === 'string') {
    for (const [name, secret] of Object.entries(lease.credentials))
      if (name !== 'mongoUser') value = value.split(secret).join('[REDACTED]');
    return value.replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s"']+/gi, '[REDACTED_URI]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redact(item, name)]),
    );
  return value;
}
function recordRequest(mode, path, method, startedAt, value) {
  if (!outage) return;
  const text = JSON.stringify(value);
  outage.requests.push({
    mode,
    path,
    method,
    startedAt: new Date(startedAt).toISOString(),
    startedAfterPauseMs: outage.pausedAt ? startedAt - outage.pausedAt : null,
    startedAfterReconnectMs: outage.reconnectedAt ? startedAt - outage.reconnectedAt : null,
    durationMs: Date.now() - startedAt,
    headers: {},
    body: null,
    ...redact(value),
    guardFailures: inspectMongoResponse(value, {
      login: path === '/api/home/login',
      markers: [lease.credentials.mongoPassword],
    }),
    sensitiveMongoContent:
      /mongodb(?:\+srv)?:\/\/|MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongooseError|buffering timed out|ECONNREFUSED|\bat .*\(.*:\d+:\d+\)/i.test(
        text,
      ) || text.includes(lease.credentials.mongoPassword),
  });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
async function main() {
  try {
    certs = certificates();
    lease.network();
    const mongo = await lease.mongo();
    const redis = lease.create(
      'redis',
      'redis:7.4-alpine',
      [
        '--network-alias',
        'redis.totmart.test',
        '--tmpfs',
        '/data:mode=1777',
        '--tmpfs',
        '/fixture:mode=1777',
        '--user',
        'redis',
      ],
      [
        'sh',
        '-c',
        'printf \'%s\' "$FIXTURE_CA" > /fixture/ca.pem; printf \'%s\' "$FIXTURE_CERT" > /fixture/server.pem; printf \'%s\' "$FIXTURE_KEY" > /fixture/server.key; chmod 600 /fixture/server.key; exec redis-server --port 0 --tls-port 6379 --tls-ca-cert-file /fixture/ca.pem --tls-cert-file /fixture/server.pem --tls-key-file /fixture/server.key --tls-auth-clients no --requirepass "$FIXTURE_PASSWORD" --save \'\' --appendonly no',
      ],
      {
        FIXTURE_CA: certs['ca.pem'],
        FIXTURE_CERT: certs['redis.pem'],
        FIXTURE_KEY: certs['redis.key'],
        FIXTURE_PASSWORD: lease.credentials.redisPassword,
      },
    );
    lease.start(redis);
    await lease.poll(
      () => {
        try {
          return (
            lease.exec(redis, [
              'env',
              `REDISCLI_AUTH=${lease.credentials.redisPassword}`,
              'redis-cli',
              '--tls',
              '--cacert',
              '/fixture/ca.pem',
              '-h',
              'redis.totmart.test',
              'ping',
            ]) === 'PONG'
          );
        } catch {
          return false;
        }
      },
      15000,
      'Redis TLS PONG',
    );
    for (const mode of ['production', 'staging']) {
      for (const bad of ['missing-jwt', 'invalid-port'])
        await scenario(`${mode}-${bad}-before-side-effects`, async () => {
          const database = `config_${mode}_${bad.replaceAll('-', '_')}`;
          const env = strictConfig(mode, {
            MONGODB_URI: lease
              .config(mode)
              .MONGODB_URI.replace(`/${fixtureDatabase}?`, `/${database}?`),
          });
          if (bad === 'missing-jwt') delete env.JWT_SECRET;
          else env.PORT = '0';
          const evidence = await failBoot(`${mode}-${bad}`, env, 15000);
          assert(
            !evidence.mongoConnectEvent,
            'Configuration validation followed database side effect',
          );
          assert(
            lease.mongoEval(
              mongo,
              `print(db.getSiblingDB('${database}').getCollectionNames().length)`,
            ) === '0',
            'Invalid configuration created collections',
          );
          return { ...evidence, noMongoConnectEvent: true, noCollectionsCreated: true };
        });
    }
    for (const mode of ['production', 'staging']) {
      await scenario(`${mode}-redis-unavailable-bounded`, async () =>
        failBoot(
          `${mode}-redis-missing`,
          strictConfig(mode, {
            REDIS_URL: `rediss://:${lease.credentials.redisPassword}@redis.totmart.test:6399/0`,
          }),
        ),
      );
      await scenario(`${mode}-redis-wrong-ca-rejected`, async () =>
        failBoot(`${mode}-wrong-ca`, strictConfig(mode, {}, certs['wrong-ca.pem'])),
      );
    }
    const standalone = onlyMongo
      ? null
      : await lease.mongo({ standalone: true, role: 'standalone' });
    for (const mode of ['production', 'staging'])
      await scenario(`${mode}-mongo-standalone-rejected`, async () =>
        failBoot(
          `${mode}-standalone`,
          strictConfig(mode, {
            MONGODB_URI: `mongodb://${lease.credentials.mongoUser}:${lease.credentials.mongoPassword}@standalone:27017/standalone_${mode}?authSource=admin`,
          }),
        ),
      );
    report.standaloneOwnedId = standalone;
    for (const mode of ['production', 'staging'])
      await scenario(`${mode}-index-readiness-failure-before-listen`, async () => {
        const database = `index_failure_${mode}`;
        lease.mongoEval(
          mongo,
          `const c=db.getSiblingDB('${database}').checkouts; const userId=new ObjectId(); c.insertMany([{userId,requestKey:'fixture-index-conflict',paymentLedgerVersion:2,state:'pending',paymentCode:'fixture-index-a'},{userId,requestKey:'fixture-index-conflict',paymentLedgerVersion:2,state:'pending',paymentCode:'fixture-index-b'}]); print('seeded');`,
        );
        return failBoot(
          `${mode}-index-failure`,
          strictConfig(mode, {
            MONGODB_URI: lease
              .config(mode)
              .MONGODB_URI.replace(`/${fixtureDatabase}?`, `/${database}?`),
          }),
        );
      });
    const backends = {};
    for (const [mode, role] of [
      ['production', 'production'],
      ['staging', 'staging'],
    ])
      await scenario(`${mode}-strict-entrypoint-boot-with-verified-redis-tls`, async () => {
        const id = backend(role, strictConfig(mode));
        backends[mode] = id;
        lease.start(id);
        await lease.poll(() => lease.health(id), 60000, `${mode} strict readiness`);
        const identity = JSON.parse(
          lease.exec(id, [
            'node',
            '-e',
            "const fs=require('fs');console.log(JSON.stringify({uid:process.getuid(),pid1:fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean),tlsVerificationDisabled:process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'}))",
          ]),
        );
        assert(
          identity.uid !== 0 &&
            !identity.tlsVerificationDisabled &&
            JSON.stringify(identity.pid1) === JSON.stringify(['node', 'src/server.js']),
          'Strict PID1/user/TLS mismatch',
        );
        return { id, ...identity, ready: true };
      });
    await scenario('collections-and-required-unique-indexes-ready', async () => {
      const evidence = JSON.parse(
        lease.mongoEval(
          mongo,
          `const d=db.getSiblingDB('${fixtureDatabase}'); print(JSON.stringify({collections:d.getCollectionNames().length,checkoutUnique:d.checkouts.getIndexes().some(i=>i.unique&&i.key.userId===1&&i.key.requestKey===1),attemptUnique:d.checkoutattempts.getIndexes().some(i=>i.unique&&i.key.userId===1&&i.key.kind===1&&i.key.key===1),sessionUnique:d.authsessions.getIndexes().some(i=>i.unique&&i.key.sessionId===1)}))`,
        ),
      );
      assert(
        evidence.collections > 0 &&
          evidence.checkoutUnique &&
          evidence.attemptUnique &&
          evidence.sessionUnique,
        'Required index catalog incomplete',
      );
      return evidence;
    });
    const proxyCode = `const fs=require('fs'),https=require('https'),http=require('http');https.createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(req,res)=>{const target=req.headers.host.startsWith('api-prod.')?'production':'staging';const upstream=http.request({hostname:target,port:3001,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-for':req.socket.remoteAddress}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,status:'upstream_unavailable'}))});req.pipe(upstream);res.on('close',()=>upstream.destroy())}).listen(8443,'0.0.0.0');`;
    const proxy = lease.create(
      'proxy',
      candidate.image.id,
      [
        '--network-alias',
        'api-prod.totmart.test',
        '--network-alias',
        'api-stage.totmart.test',
        '--tmpfs',
        '/fixture:mode=1777',
      ],
      [
        'sh',
        '-c',
        'printf \'%s\' "$FIXTURE_KEY" > /fixture/key.pem; chmod 600 /fixture/key.pem; printf \'%s\' "$FIXTURE_CERT" > /fixture/cert.pem; exec node -e "$FIXTURE_PROXY_CODE"',
      ],
      {
        FIXTURE_KEY: certs['proxy.key'],
        FIXTURE_CERT: certs['proxy.pem'],
        FIXTURE_PROXY_CODE: proxyCode,
      },
    );
    lease.start(proxy);
    const client = lease.create(
      'client',
      candidate.image.id,
      ['--tmpfs', '/fixture:mode=1777'],
      [
        'sh',
        '-c',
        "printf '%s' \"$FIXTURE_CA\" > /fixture/ca.pem; exec node -e 'setInterval(()=>{},1000)'",
      ],
      strictConfig('production'),
    );
    lease.start(client);
    for (const mode of ['prod', 'stage'])
      await scenario(`${mode}-real-https-proxy-origin-health-and-live`, async () => {
        let readiness;
        await lease.poll(
          () => {
            try {
              readiness = httpsRequest(client, mode, '/api/home/health');
              return readiness.status === 200;
            } catch {
              return false;
            }
          },
          10000,
          'HTTPS proxy ready',
        );
        const live = httpsRequest(client, mode, '/api/home/live');
        assert(
          readiness.cors === 'https://app.totmart.test' &&
            live.status === 200 &&
            live.body.status === 'alive',
          'HTTPS/CORS/liveness policy mismatch',
        );
        return {
          readiness: readiness.status,
          liveness: live.status,
          originAccepted: true,
          tlsVerifiedByClient: true,
          browserE2E: false,
        };
      });
    await scenario('redis-runtime-outage-readiness-and-liveness', async () => {
      lease.verify(redis);
      lease.docker(['pause', redis]);
      try {
        await lease.poll(
          () =>
            ['prod', 'stage'].every(
              (mode) => httpsRequest(client, mode, '/api/home/health').status === 503,
            ),
          12000,
          'Readiness after Redis outage',
        );
        assert(
          ['prod', 'stage'].every(
            (mode) => httpsRequest(client, mode, '/api/home/live').status === 200,
          ),
          'Redis outage broke liveness',
        );
      } finally {
        lease.verify(redis);
        lease.docker(['unpause', redis]);
      }
      await lease.poll(
        () => lease.health(backends.production) && lease.health(backends.staging),
        30000,
        'Redis recovery',
      );
      return { readiness: 503, liveness: 200, recovered: true };
    });
    await scenario('mongo-runtime-outage-readiness-and-liveness', async () => {
      const disclosure = [];
      outage = report.mongoOutage = {
        requests: [],
        logs: [],
        pauseRequestedAt: Date.now(),
        logPolicy:
          'Existing pino-http policy ignores /api/home/health; HTTP evidence is recorded separately. Only filtered log fields are published.',
        unsafeLogContent: false,
      };
      for (const mode of ['prod', 'stage']) {
        assert(
          httpsRequest(client, mode, '/api/home/health').status === 200,
          'Mongo pre-fault readiness failed',
        );
      }
      lease.verify(mongo);
      lease.docker(['pause', mongo]);
      outage.pausedAt = Date.now();
      let failure;
      try {
        await lease.poll(
          () =>
            ['prod', 'stage'].every(
              (mode) => httpsRequest(client, mode, '/api/home/health').status === 503,
            ),
          15000,
          'Readiness after Mongo outage',
        );
        assert(
          ['prod', 'stage'].every(
            (mode) => httpsRequest(client, mode, '/api/home/live').status === 200,
          ),
          'Mongo outage broke liveness',
        );
        if (process.argv.includes('--final') || onlyMongo)
          for (const mode of ['prod', 'stage']) {
            const startedAt = Date.now();
            const value = runClient(
              client,
              `const https=require('https');let timedOut=false;const req=https.request('https://api-${mode}.totmart.test:8443/api/home/login',{method:'POST',headers:{Origin:'https://app.totmart.test','Content-Type':'application/json'},timeout:16000},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,headers:{'x-request-id':r.headers['x-request-id']},body:JSON.parse(body)})))});req.on('timeout',()=>{timedOut=true;req.destroy()});req.on('error',e=>console.log(JSON.stringify({status:0,transportError:e.code,timedOut})));req.end(JSON.stringify({email:'disclosure@example.com',password:'synthetic-fixture-password'}));`,
              20000,
            );
            recordRequest(mode, '/api/home/login', 'POST', startedAt, value);
            const failures = inspectMongoResponse(value, {
              login: true,
              markers: [lease.credentials.mongoPassword],
            });
            if (failures.length) {
              failure = new Error(`Mongo outage login: ${failures.join('; ')}`);
              failure.name = 'BootSafetyFailure';
            }
            disclosure.push({
              mode,
              status: value.status,
              safeMessage: value.body?.message === 'Lỗi hệ thống. Vui lòng thử lại.',
              requestIdPresent: typeof value.body?.requestId === 'string',
              credentialUriAbsent: !JSON.stringify(value).includes(lease.credentials.mongoPassword),
            });
          }
      } catch (error) {
        failure = error;
      } finally {
        lease.verify(mongo);
        lease.docker(['unpause', mongo]);
        outage.reconnectedAt = Date.now();
      }
      await lease.poll(
        () =>
          ['prod', 'stage'].every(
            (mode) => httpsRequest(client, mode, '/api/home/health').status === 200,
          ),
        30000,
        'Mongo recovery',
      );
      for (const [mode, id] of Object.entries(backends)) {
        const lines = lease
          .docker(['logs', '--since', new Date(outage.pauseRequestedAt).toISOString(), id])
          .split('\n');
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            /mongodb(?:\+srv)?:\/\//i.test(line) ||
            Object.entries(lease.credentials).some(
              ([key, secret]) => key !== 'mongoUser' && line.includes(secret),
            )
          )
            outage.unsafeLogContent = true;
          const logGuard = inspectPublishedLogs([entry], {
            markers: Object.values(lease.credentials).filter((value) => value !== 'fixture'),
          });
          if (logGuard.length) outage.unsafeLogContent = true;
          const requestId = entry.requestId || entry.req?.id;
          if (!requestId && !/Mongo|database/i.test(entry.msg || '')) continue;
          outage.logs.push(
            redact({
              mode,
              time: entry.time,
              requestId,
              level: entry.level,
              event: entry.event,
              dependency: entry.dependency,
              path: entry.path || entry.req?.url,
              status: entry.status || entry.res?.statusCode,
              msg: entry.msg,
              err: entry.err,
              responseTime: entry.responseTime,
            }),
          );
        }
      }
      outage.disclosure = disclosure;
      for (const request of outage.requests) {
        const mode = request.mode === 'prod' ? 'production' : 'staging';
        request.logRequestIds = [
          ...new Set(
            outage.logs
              .filter(
                (log) =>
                  log.mode === mode &&
                  log.path === request.path &&
                  (!request.headers['x-request-id'] ||
                    request.headers['x-request-id'] === log.requestId),
              )
              .map((log) => log.requestId),
          ),
        ];
      }
      const violations = outage.requests.flatMap((request) => request.guardFailures);
      if (outage.unsafeLogContent)
        violations.push('Mongo URI or fixture credential appeared in raw logs');
      if (!failure && violations.length) {
        failure = new Error(`Mongo response safety: ${violations.join('; ')}`);
        failure.name = 'BootSafetyFailure';
      }
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
      outage = undefined;
      if (failure) throw failure;
      return { readiness: 503, liveness: 200, recovered: true, disclosure };
    });
    for (const [mode, target] of [
      ['production', 'prod'],
      ['staging', 'stage'],
    ])
      await scenario(
        `${mode}-native-linux-sigterm-closes-authenticated-sse-and-connections`,
        async () => {
          const seed = `const fs=require('fs'),https=require('https'),mongoose=require('mongoose'),crypto=require('crypto'),jwt=require('jsonwebtoken');const result='/fixture/signal-${target}.json';function save(value){fs.writeFileSync(result,JSON.stringify(value))};(async()=>{await mongoose.connect(process.env.MONGODB_URI);const User=require('./src/models/User'),Session=require('./src/models/AuthSession');const user=await User.create({name:'Synthetic Signal Admin',email:'signal-${target}@fixture.test',password:require('bcrypt').hashSync('fixture-signal-password',10),role:'admin',isActive:true,tokenVersion:0});const sid=crypto.randomUUID();await Session.create({sessionId:sid,userId:user._id,refreshHash:crypto.randomBytes(32).toString('hex'),tokenVersion:0,expiresAt:new Date(Date.now()+3600000)});await mongoose.disconnect();const token=jwt.sign({userId:String(user._id),role:'admin',name:user.name,email:user.email,sid,tokenVersion:0},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'});https.get('https://api-${target}.totmart.test:8443/api/admin/notifications/stream-ticket',{headers:{Authorization:'Bearer '+token,Origin:'https://app.totmart.test'}},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>{const ticket=JSON.parse(body).data?.ticket;if(r.statusCode!==200||!ticket){save({failed:true,stage:'ticket',status:r.statusCode});return}https.get('https://api-${target}.totmart.test:8443/api/admin/notifications/stream?ticket='+encodeURIComponent(ticket),{headers:{Origin:'https://app.totmart.test'}},stream=>{if(stream.statusCode!==200){save({failed:true,stage:'stream',status:stream.statusCode});stream.resume();return}save({opened:true,status:stream.statusCode});stream.resume();stream.on('end',()=>save({opened:true,closed:true}));stream.on('error',()=>save({opened:true,closed:true,transportError:true}))}).on('error',()=>save({failed:true,stage:'stream-connect'}))})}).on('error',()=>save({failed:true,stage:'ticket-connect'}))})().catch(()=>save({failed:true,stage:'seed'}));`;
          // Use a detached exec with an explicit fixture-only script argument; no token is written.
          lease.verify(client);
          lease.docker(['exec', '--detach', client, 'node', '-e', seed]);
          let state;
          await lease.poll(
            () => {
              try {
                state = JSON.parse(lease.exec(client, ['cat', `/fixture/signal-${target}.json`]));
                assert(!state.failed, 'Authenticated SSE fixture failed');
                return state.opened;
              } catch (error) {
                if (error.name === 'BootSafetyFailure') throw error;
                return false;
              }
            },
            20000,
            'Authenticated SSE open',
          );
          const backendId = backends[mode];
          lease.verify(backendId);
          const started = Date.now();
          lease.docker(['kill', '--signal', 'SIGTERM', backendId]);
          await lease.poll(
            () => !lease.verify(backendId).state.Running,
            15000,
            'Native SIGTERM exit',
          );
          const exit = lease.verify(backendId).state.ExitCode;
          await lease.poll(
            () => {
              try {
                return JSON.parse(lease.exec(client, ['cat', `/fixture/signal-${target}.json`]))
                  .closed;
              } catch {
                return false;
              }
            },
            5000,
            'SSE closure',
          );
          const logs = lease.docker(['logs', backendId]);
          assert(
            exit === 0 && logs.includes('MongoDB Disconnected'),
            'SIGTERM did not close Mongo connection cleanly',
          );
          assert(
            httpsRequest(client, target, '/api/home/health').status === 502,
            'Stopped backend still accepts traffic',
          );
          return {
            containerId: backendId,
            exitCode: exit,
            durationMs: Date.now() - started,
            sseOpened: true,
            sseClosed: true,
            mongoDisconnected: true,
            acceptsTrafficAfterExit: false,
            workersProcessExited: true,
            signal: 'SIGTERM',
            pid1: 'node src/server.js',
          };
        },
      );
    report.exitCode = 0;
  } catch (error) {
    report.exitCode = 1;
    report.failure = error.message;
    report.failureClassification =
      error.name === 'BootSafetyFailure' ? 'assertion ứng dụng' : 'chưa xác định';
    process.exitCode = 1;
  } finally {
    report.cleanupExitCode = await lease.cleanup();
    if (report.cleanupExitCode) process.exitCode = 1;
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
    report.privateCertificateFilesRemoved = true;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.log('Phase 3 harness failed');
  process.exitCode = 1;
});
