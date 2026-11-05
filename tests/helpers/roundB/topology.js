const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Lease, candidate } = require('./image-fixture');
const certificates = require('./certificates');
async function topology(
  phase,
  {
    observerSource,
    proxyObserverSource,
    notificationSource,
    failpoints = false,
    mongoAckProxy = false,
  } = {},
) {
  if (
    notificationSource &&
    (!observerSource ||
      path.resolve(notificationSource) !==
        path.resolve('src/controllers/notificationController.js'))
  )
    throw Error('Unapproved source overlay');
  const lease = new Lease(phase);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `totmart-b-${lease.run}-certs-`));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return 0;
    const code = await lease.cleanup();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
    cleaned = true;
    return code;
  };
  try {
    const certs = certificates(directory, lease);
    lease.network();
    const mongo = await lease.mongo({ failpoints });
    let ackProxy;
    if (mongoAckProxy) {
      ackProxy = lease.create(
        'mongo-ack',
        candidate.image.id,
        ['--network-alias', 'mongo-ack', '--tmpfs', '/fixture:mode=1777'],
        [
          'sh',
          '-c',
          'while [ ! -f /fixture/a2-mongo-proxy.js ]; do sleep 0.1; done; exec node /fixture/a2-mongo-proxy.js',
        ],
      );
      lease.start(ackProxy);
      lease.copyFile(
        'tests/helpers/roundB/a2-mongo-proxy.js',
        ackProxy,
        '/fixture/a2-mongo-proxy.js',
      );
      await lease.poll(
        () => {
          try {
            return (
              lease.exec(ackProxy, [
                'node',
                '-e',
                "fetch('http://127.0.0.1:28080/status').then(r=>r.json()).then(v=>console.log(v.ready))",
              ]) === 'true'
            );
          } catch {
            return false;
          }
        },
        15000,
        'Mongo ACK proxy readiness',
      );
    }
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
      'Redis TLS readiness',
    );
    const config = (mode) => {
      const value = lease.config(mode, {
        FIXTURE_RUN: lease.run,
        FIXTURE_CA: certs['ca.pem'],
        NODE_EXTRA_CA_CERTS: '/fixture/ca.pem',
        NODE_PATH: '/app/node_modules',
        REDIS_URL: `rediss://:${lease.credentials.redisPassword}@redis.totmart.test:6379/0`,
      });
      if (notificationSource)
        value.FIXTURE_SSE_SOURCE_SHA256 = require('node:crypto')
          .createHash('sha256')
          .update(fs.readFileSync(notificationSource))
          .digest('hex');
      if (failpoints) value.MONGODB_URI += '&appName=totmart-fixture-' + mode;
      // One-node disposable topology only; directConnection prevents discovery bypassing the wire proxy.
      // Driver/session/transaction timeout and retry options remain the application defaults.
      if (mongoAckProxy && mode === 'production')
        value.MONGODB_URI =
          value.MONGODB_URI.replace('@mongo:27017/', '@mongo-ack:27017/') +
          '&directConnection=true';
      return value;
    };
    const backends = [];
    for (const mode of ['production', 'staging']) {
      const id = lease.backend(mode, config(mode), [
        'sh',
        '-c',
        observerSource
          ? 'printf \'%s\' "$FIXTURE_CA" > /fixture/ca.pem; while [ ! -f /fixture/mongo-observer.js ]; do sleep 0.1; done; ' +
            (notificationSource
              ? 'while [ ! -f /fixture/notification-controller.js ]; do sleep 0.1; done; '
              : '') +
            'exec node --require /fixture/mongo-observer.js src/server.js'
          : 'printf \'%s\' "$FIXTURE_CA" > /fixture/ca.pem; exec node src/server.js',
      ]);
      backends.push(id);
      lease.start(id);
      if (observerSource) lease.copyFile(observerSource, id, '/fixture/mongo-observer.js');
      if (notificationSource)
        lease.copyFile(notificationSource, id, '/fixture/notification-controller.js');
      await lease.poll(() => lease.health(id), 60000, `${mode} server.js readiness`);
    }
    const proxyCode = `const fs=require('fs'),https=require('https'),http=require('http');https.createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(req,res)=>{const target=req.headers.host.startsWith('api-prod.')?'production':'staging';const upstream=http.request({hostname:target,port:3001,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-for':req.socket.remoteAddress}},r=>{if(req.headers['x-fixture-drop-response']==='1'&&[200,201].includes(r.statusCode)){r.resume();r.on('end',()=>{fs.writeFileSync('/fixture/drop-proof.json',JSON.stringify({path:req.url,status:r.statusCode,upstreamEndedAt:Date.now()}));res.destroy()});return}res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,status:'upstream_unavailable'}))});req.pipe(upstream);res.on('close',()=>upstream.destroy())}).listen(8443,'0.0.0.0');`;
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
        'printf \'%s\' "$FIXTURE_KEY" > /fixture/key.pem; chmod 600 /fixture/key.pem; printf \'%s\' "$FIXTURE_CERT" > /fixture/cert.pem; ' +
          (proxyObserverSource
            ? 'while [ ! -f /fixture/sse-observer.js ]; do sleep 0.1; done; exec node --require /fixture/sse-observer.js -e "$FIXTURE_PROXY_CODE"'
            : 'exec node -e "$FIXTURE_PROXY_CODE"'),
      ],
      {
        FIXTURE_KEY: certs['proxy.key'],
        FIXTURE_CERT: certs['proxy.pem'],
        FIXTURE_PROXY_CODE: proxyCode,
      },
    );
    lease.start(proxy);
    if (proxyObserverSource) lease.copyFile(proxyObserverSource, proxy, '/fixture/sse-observer.js');
    const client = lease.create(
      'client',
      candidate.image.id,
      ['--tmpfs', '/fixture:mode=1777'],
      [
        'sh',
        '-c',
        "printf '%s' \"$FIXTURE_CA\" > /fixture/ca.pem; exec node -e 'setInterval(()=>{},1000)'",
      ],
      {
        ...config('production'),
        ...(failpoints
          ? {
              MONGODB_URI: config('production').MONGODB_URI.replace(
                'appName=totmart-fixture-production',
                'appName=totmart-fixture-control',
              ),
            }
          : {}),
        ...(mongoAckProxy
          ? {
              MONGODB_URI: config('staging').MONGODB_URI.replace(
                'appName=totmart-fixture-staging',
                'appName=totmart-fixture-control',
              ),
            }
          : {}),
      },
    );
    lease.start(client);
    for (const [source, destination] of [
      ['tests/helpers/roundB/adapter.js', 'adapter.js'],
      ['tests/helpers/roundB/client.js', 'client.js'],
      ['tests/helpers/roundB/fault-client.js', 'fault-client.js'],
      ['tests/helpers/roundC2/sse-deadline.js', 'sse-deadline.js'],
      ['artifacts/round-b/b06-image-source.txt', 'b06.js'],
      ['artifacts/round-b/factories-image.txt', 'factories.js'],
    ]) {
      lease.verify(client);
      lease.copyFile(source, client, `/fixture/${destination}`);
    }
    function run(command, timeout = 30000) {
      const output = lease.exec(client, ['node', '/fixture/client.js', command], timeout);
      const line = output.split('\n').findLast((line) => line.startsWith('ROUND_B_RESULT='));
      if (!line) throw Error('Fixture did not publish sanitized result');
      return JSON.parse(line.slice('ROUND_B_RESULT='.length));
    }
    await lease.poll(
      () => {
        try {
          return run('health').passed;
        } catch {
          return false;
        }
      },
      15000,
      'HTTPS proxy readiness',
    );
    return { lease, mongo, redis, backends, proxy, ackProxy, client, run, cleanup };
  } catch (error) {
    error.cleanupExitCode = await cleanup();
    throw error;
  }
}
module.exports = topology;
