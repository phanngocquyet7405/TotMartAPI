const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { MongoClient } = require('mongoose').mongo;
const net = require('node:net');
const root = path.resolve(process.env.C1_DIRECTORY || 'artifacts/round-c1/' + randomUUID());
fs.mkdirSync(root, { recursive: true });
const run = path.basename(root);
if (!/^[a-f0-9-]{36}$/.test(run) || path.dirname(root) !== path.resolve('artifacts/round-c1'))
  throw new Error('C1 evidence directory mismatch');
const write = (name, value) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const commands = [];
function docker(args, options = {}) {
  try {
    const out = execFileSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    commands.push({ operation: args[0], exitCode: 0 });
    return typeof out === 'string' ? out.trim() : out;
  } catch (error) {
    commands.push({ operation: args[0], exitCode: error.status ?? null });
    throw new Error('C1 Docker ' + args[0] + ' failed', { cause: error });
  } finally {
    write('docker-commands-' + process.pid + '.json', commands);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mongo(role) {
  const name = `totmart-c1-${run}-${role}`,
    volumes = [],
    resource = { run, name, id: null, volumes, absent: false };
  const file = `resources-${role}-${process.env.C1_ATTEMPT || randomUUID()}.json`;
  const record = () => write(file, resource);
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const database = 'totmart_c1_' + role.replaceAll('-', '_') + '_' + run.replaceAll('-', '');
  let client;
  function verifyVolume(v) {
    const info = JSON.parse(docker(['volume', 'inspect', '--format', '{{json .}}', v.name]));
    if (info.Name !== v.name || info.Labels?.['totmart.test.run'] !== run)
      throw new Error('C1 volume ownership mismatch');
  }
  function verify() {
    const info = JSON.parse(
      docker([
        'inspect',
        '--format',
        '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}',
        resource.id,
      ]),
    );
    if (
      info.id !== resource.id ||
      !/^[a-f0-9]{64}$/.test(info.id) ||
      info.name !== '/' + name ||
      info.labels?.['totmart.test.run'] !== run ||
      info.ports?.['27017/tcp']?.[0]?.HostIp !== '127.0.0.1' ||
      Number(info.ports['27017/tcp'][0].HostPort) !== port
    )
      throw new Error('C1 Mongo ownership mismatch');
    for (const v of volumes) {
      verifyVolume(v);
      if (
        !info.mounts.some(
          (m) => m.Type === 'volume' && m.Name === v.name && m.Destination === v.destination,
        )
      )
        throw new Error('C1 mount mismatch');
    }
  }
  const uri = (db) => `mongodb://127.0.0.1:${port}/${db}?directConnection=true&replicaSet=c1`;
  async function cleanup() {
    await client?.close();
    if (resource.id) {
      verify();
      docker(['rm', '-f', resource.id]);
      if (
        docker(['ps', '-a', '--no-trunc', '--filter', 'id=' + resource.id, '--format', '{{.ID}}'])
      )
        throw new Error('C1 container still present');
      resource.absent = true;
      record();
    }
    for (const v of volumes) {
      verifyVolume(v);
      docker(['volume', 'rm', v.name]);
      if (
        docker(['volume', 'ls', '--filter', 'name=' + v.name, '--format', '{{.Name}}'])
          .split('\n')
          .includes(v.name)
      )
        throw new Error('C1 volume still present');
      v.absent = true;
      record();
    }
  }
  try {
    for (const [suffix, destination] of [
      ['data', '/data/db'],
      ['config', '/data/configdb'],
      ['archive', '/archive'],
    ]) {
      const v = { name: name + '-' + suffix, destination, absent: false };
      if (docker(['volume', 'ls', '--filter', 'name=' + v.name, '--format', '{{.Name}}']))
        throw new Error('C1 refuses existing volume');
      docker(['volume', 'create', '--label', `totmart.test.run=${run}`, v.name]);
      volumes.push(v);
      record();
      verifyVolume(v);
    }
    resource.id = docker([
      'create',
      '--name',
      name,
      '--label',
      `totmart.test.run=${run}`,
      '--publish',
      `127.0.0.1:${port}:27017`,
      ...volumes.flatMap((v) => [
        '--mount',
        `type=volume,source=${v.name},target=${v.destination}`,
      ]),
      'mongo:7.0',
      'mongod',
      '--replSet',
      'c1',
      '--bind_ip_all',
    ]);
    resource.port = port;
    resource.database = database;
    record();
    verify();
    docker(['start', resource.id]);
    client = new MongoClient(uri(database), { serverSelectionTimeoutMS: 2000 });
    const deadline = Date.now() + 45000;
    while (true) {
      try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        break;
      } catch {
        if (Date.now() > deadline) throw new Error('C1 Mongo startup deadline');
        await wait(200);
      }
    }
    await client
      .db('admin')
      .command({ replSetInitiate: { _id: 'c1', members: [{ _id: 0, host: 'localhost:27017' }] } });
    let hello;
    while (!(hello = await client.db('admin').command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw new Error('C1 PRIMARY deadline');
      await wait(200);
    }
    resource.processId = String(hello.topologyVersion.processId);
    resource.marker = randomUUID();
    await client
      .db(database)
      .collection('c1ownership')
      .insertOne({ _id: run, marker: resource.marker, processId: resource.processId });
    record();
    return {
      database,
      uri,
      client,
      db: client.db(database),
      resource,
      verify,
      cleanup,
      async assertTarget(db = client.db(database)) {
        verify();
        const h = await client.db('admin').command({ hello: 1 });
        const marker = await client.db(database).collection('c1ownership').findOne({ _id: run });
        if (
          db.client !== client ||
          db.databaseName !== database ||
          String(h.topologyVersion.processId) !== resource.processId ||
          marker?.marker !== resource.marker
        )
          throw new Error('C1 Mongo identity mismatch');
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
module.exports = { root, run, write, sha, docker, mongo, wait };
