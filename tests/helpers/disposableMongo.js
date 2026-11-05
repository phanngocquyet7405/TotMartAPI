const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const { MongoClient } = require('mongoose').mongo;
const fs = require('node:fs');
const { sha256 } = require('../../scripts/evidence-manifest');
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
async function disposableMongo(onEvidence) {
  const owner = randomUUID(),
    name = `totmart-b07-${owner}-mongo`,
    database = `totmart_b07_${owner.replaceAll('-', '')}`;
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  let id, client;
  const evidence = { owner, name, id: null, port, database, cleaned: false, tmpfs: true };
  const uri = (db) => `mongodb://127.0.0.1:${port}/${db}?directConnection=true&replicaSet=b07`;
  function verify() {
    const info = JSON.parse(docker(['inspect', id]))[0],
      bindings = info.HostConfig?.PortBindings?.['27017/tcp'];
    if (
      !/^[a-f0-9]{64}$/.test(id || '') ||
      info.Id !== id ||
      info.Name !== '/' + name ||
      info.Config?.Labels?.['totmart.test.run'] !== owner ||
      bindings?.length !== 1 ||
      bindings[0].HostIp !== '127.0.0.1' ||
      Number(bindings[0].HostPort) !== port
    )
      throw new Error('Owned Mongo target mismatch');
    return info;
  }
  function action(operation) {
    if (!['pause', 'unpause'].includes(operation))
      throw new Error('Unsupported Mongo drill action');
    verify();
    docker([operation, id]);
    verify();
  }
  async function cleanup() {
    if (!id) return;
    const info = verify();
    if (info.State.Paused) action('unpause');
    await client?.close();
    docker(['rm', '-f', id]);
    evidence.cleaned = true;
    onEvidence({ ...evidence });
    id = undefined;
  }
  try {
    id = docker([
      'create',
      '--name',
      name,
      '--label',
      `totmart.test.run=${owner}`,
      '--publish',
      `127.0.0.1:${port}:27017`,
      '--tmpfs',
      '/data/db',
      '--tmpfs',
      '/data/configdb',
      'mongo:7.0',
      'mongod',
      '--replSet',
      'b07',
      '--bind_ip_all',
      '--setParameter',
      'enableTestCommands=1',
    ]);
    evidence.id = id;
    onEvidence({ ...evidence });
    verify();
    docker(['start', id]);
    verify();
    client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, {
      serverSelectionTimeoutMS: 2000,
    });
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        break;
      } catch {
        if (Date.now() > deadline) throw new Error('Owned Mongo startup deadline');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    verify();
    await client
      .db('admin')
      .command({ replSetInitiate: { _id: 'b07', members: [{ _id: 0, host: 'localhost:27017' }] } });
    while (!(await client.db('admin').command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw new Error('Owned Mongo primary deadline');
      await new Promise((r) => setTimeout(r, 100));
    }
    evidence.version = (await client.db('admin').command({ buildInfo: 1 })).version;
    evidence.tools = {
      dump: docker(['exec', id, 'mongodump', '--version']).split('\n')[0],
      restore: docker(['exec', id, 'mongorestore', '--version']).split('\n')[0],
    };
    onEvidence({ ...evidence });
    return {
      database,
      uri,
      verify,
      action,
      cleanup,
      async failpoint(value) {
        verify();
        return client.db('admin').command({ configureFailPoint: 'failCommand', ...value });
      },
      dump(destination) {
        verify();
        docker([
          'exec',
          id,
          'mongodump',
          `--uri=mongodb://localhost:27017/${database}?replicaSet=b07`,
          '--archive=/tmp/b07.archive',
          '--gzip',
        ]);
        verify();
        docker(['cp', `${id}:/tmp/b07.archive`, destination]);
      },
      restore(destination, archive) {
        if (destination !== database + '_restored')
          throw new Error('Owned restore namespace mismatch');
        verify();
        // Restore the retained host file, not an unverified earlier container copy.
        const before = sha256(fs.readFileSync(archive));
        docker(['cp', archive, `${id}:/tmp/b07.restore.archive`]);
        verify();
        const containerBefore = docker(['exec', id, 'sha256sum', '/tmp/b07.restore.archive']).split(
          /\s+/,
        )[0];
        if (containerBefore !== before)
          throw new Error('Restore archive transfer checksum mismatch');
        docker([
          'exec',
          id,
          'mongorestore',
          '--uri=mongodb://localhost:27017/?replicaSet=b07',
          '--archive=/tmp/b07.restore.archive',
          '--gzip',
          `--nsFrom=${database}.*`,
          `--nsTo=${destination}.*`,
        ]);
        verify();
        const after = sha256(fs.readFileSync(archive));
        const containerAfter = docker(['exec', id, 'sha256sum', '/tmp/b07.restore.archive']).split(
          /\s+/,
        )[0];
        if (after !== before || containerAfter !== before)
          throw new Error('Restore archive changed');
        return { before, after, containerBefore, containerAfter };
      },
    };
  } catch (error) {
    if (!id) {
      try {
        const candidate = JSON.parse(docker(['inspect', name]))[0];
        if (
          candidate.Config?.Labels?.['totmart.test.run'] === owner &&
          candidate.Name === '/' + name &&
          /^[a-f0-9]{64}$/.test(candidate.Id)
        ) {
          id = candidate.Id;
          evidence.id = id;
          onEvidence({ ...evidence });
        }
      } catch {
        /* No owned resource recovered. */
      }
    }
    await cleanup();
    throw error;
  }
}
module.exports = { disposableMongo };
