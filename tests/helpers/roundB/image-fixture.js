const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const candidate = JSON.parse(
  fs.readFileSync(process.env.ROUND_B_CLOSE_CANDIDATE_FILE || 'artifacts/round-b/candidate.json'),
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Lease {
  constructor(phase) {
    this.phase = phase;
    this.run = randomUUID();
    this.resources = [];
    this.commands = [];
    this.credentials = {
      mongoUser: 'fixture',
      mongoPassword: randomBytes(24).toString('hex'),
      redisPassword: randomBytes(24).toString('hex'),
      jwt: randomBytes(32).toString('hex'),
      refresh: randomBytes(32).toString('hex'),
      sepay: randomBytes(24).toString('hex'),
    };
  }
  docker(args, timeout = 30000) {
    try {
      const output = execFileSync('docker', args, {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      this.commands.push({ operation: args[0], exitCode: 0 });
      return output;
    } catch (error) {
      this.commands.push({ operation: args[0], exitCode: error.status ?? null });
      throw new Error(`Docker ${args[0]} failed`, { cause: error });
    }
  }
  record() {
    fs.writeFileSync(
      require('./close-context').evidence(`${this.phase}-resources.json`),
      JSON.stringify(
        { run: this.run, resources: this.resources, commands: this.commands },
        null,
        2,
      ) + '\n',
    );
  }
  network() {
    this.networkName = `totmart-b-${this.run}`;
    const id = this.docker([
      'network',
      'create',
      '--internal',
      '--label',
      `totmart.test.run=${this.run}`,
      this.networkName,
    ]);
    this.resources.push({
      type: 'network',
      id,
      name: this.networkName,
      owner: this.run,
      cleaned: false,
    });
    this.record();
    return id;
  }
  create(role, image, args = [], command = [], env = {}) {
    const name = `totmart-b-${this.run}-${role}`;
    const id = this.docker([
      'create',
      '--name',
      name,
      '--label',
      `totmart.test.run=${this.run}`,
      '--network',
      this.networkName,
      ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      ...args,
      image,
      ...command,
    ]);
    this.resources.push({
      type: 'container',
      id,
      name,
      role,
      image,
      owner: this.run,
      cleaned: false,
    });
    this.record();
    this.verify(id);
    return id;
  }
  verify(id) {
    const resource = this.resources.find((item) => item.id === id);
    if (!resource) throw new Error('Unknown lease resource');
    if (resource.type === 'network') {
      const data = JSON.parse(
        this.docker([
          'network',
          'inspect',
          '--format',
          '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Labels}},"internal":{{json .Internal}}}',
          id,
        ]),
      );
      if (
        data.id !== id ||
        data.name !== resource.name ||
        data.labels?.['totmart.test.run'] !== this.run ||
        !data.internal
      )
        throw new Error('Network ownership mismatch');
      return data;
    }
    const data = JSON.parse(
      this.docker([
        'inspect',
        '--format',
        '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"image":{{json .Image}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},"state":{{json .State}}}',
        id,
      ]),
    );
    if (
      data.id !== id ||
      data.name !== '/' + resource.name ||
      data.labels?.['totmart.test.run'] !== this.run ||
      data.network !== this.networkName ||
      data.mounts.some((mount) => mount.Type !== 'tmpfs')
    )
      throw new Error('Container ownership or storage mismatch');
    return data;
  }
  start(id) {
    this.verify(id);
    this.docker(['start', id]);
    return this.verify(id);
  }
  exec(id, args, timeout) {
    this.verify(id);
    return this.docker(['exec', id, ...args], timeout);
  }
  copyFile(source, id, destination) {
    this.verify(id);
    const bytes = fs.readFileSync(source);
    if (!/^\/fixture\/[\w-]+\.js$/.test(destination)) {
      const match = destination.match(/^\/fixture\/command-([a-f0-9-]{36})\.json$/);
      const command = match ? JSON.parse(bytes) : null;
      if (
        !command ||
        command.id !== match[1] ||
        Object.keys(command).some((key) => !['id', 'action', 'worker'].includes(key)) ||
        ![
          'drain',
          'fail-payment-once',
          'fail-expiry-once',
          'fail-delivery-once',
          'hold-notification-claim',
          'hold-security-after-publish',
          'fail-notification-once',
        ].includes(command.action) ||
        (command.worker !== undefined &&
          !['expiry', 'delivery', 'payment', 'notification', 'security'].includes(command.worker))
      )
        throw new Error('Fixture destination outside capability');
    }
    // docker cp returned success but files were absent from the running tmpfs on this engine.
    // Write through the owned container process so the active mount is used, then verify bytes.
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        id,
        'node',
        '-e',
        "const fs=require('fs'),p=process.argv[1];fs.writeFileSync(p+'.incoming',fs.readFileSync(0));fs.renameSync(p+'.incoming',p)",
        destination,
      ],
      { input: bytes, timeout: 15000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const expected = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const actual = this.exec(id, [
      'node',
      '-e',
      "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))",
      destination,
    ]);
    if (actual !== expected) throw new Error('Fixture file transfer hash mismatch');
    this.commands.push({
      operation: 'exec-write-fixture',
      exitCode: 0,
      source,
      destination,
      sha256: expected,
    });
    this.record();
  }
  async poll(work, milliseconds, label) {
    const until = Date.now() + milliseconds;
    do {
      if (await work()) return;
      await delay(300);
    } while (Date.now() < until);
    throw new Error(`${label} deadline exceeded`);
  }
  async mongo({ standalone = false, role = 'mongo', failpoints = false } = {}) {
    const key = randomBytes(48).toString('base64');
    const id = this.create(
      role,
      'mongo:7.0',
      [
        '--network-alias',
        role,
        '--tmpfs',
        '/data/db',
        '--tmpfs',
        '/data/configdb',
        '--tmpfs',
        '/fixture',
        '--health-cmd',
        "mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok ? 0 : 1)'",
        '--health-interval',
        '2s',
        '--health-timeout',
        '2s',
        '--health-retries',
        '20',
        '--entrypoint',
        'sh',
      ],
      [
        '-c',
        `printf '%s' "$MONGO_FIXTURE_KEY" > /fixture/keyfile; chmod 400 /fixture/keyfile; chown mongodb:mongodb /fixture/keyfile; exec docker-entrypoint.sh mongod --bind_ip_all --auth ${standalone ? '' : '--replSet a --keyFile /fixture/keyfile'} ${failpoints ? '--setParameter enableTestCommands=1' : ''}`,
      ],
      {
        MONGO_FIXTURE_KEY: key,
        MONGO_FIXTURE_USER: this.credentials.mongoUser,
        MONGO_FIXTURE_PASSWORD: this.credentials.mongoPassword,
      },
    );
    this.start(id);
    await this.poll(
      () => {
        try {
          return (
            this.exec(id, [
              'mongosh',
              '--quiet',
              '--eval',
              'print(db.adminCommand({ping:1}).ok)',
            ]) === '1'
          );
        } catch {
          return false;
        }
      },
      60000,
      'Mongo ping',
    );
    if (!standalone) {
      this.exec(id, [
        'mongosh',
        '--quiet',
        '--eval',
        `rs.initiate({_id:'a',members:[{_id:0,host:'${role}:27017'}]})`,
      ]);
      await this.poll(
        () =>
          this.exec(id, ['mongosh', '--quiet', '--eval', 'print(db.hello().isWritablePrimary)']) ===
          'true',
        45000,
        'Mongo PRIMARY',
      );
    }
    this.exec(id, [
      'mongosh',
      '--quiet',
      '--eval',
      "db.getSiblingDB('admin').createUser({user:process.env.MONGO_FIXTURE_USER,pwd:process.env.MONGO_FIXTURE_PASSWORD,roles:['root']})",
    ]);
    return id;
  }
  mongoEval(id, code) {
    return this.exec(id, [
      'mongosh',
      '--quiet',
      '--eval',
      "if(!db.getSiblingDB('admin').auth(process.env.MONGO_FIXTURE_USER,process.env.MONGO_FIXTURE_PASSWORD).ok)throw Error('fixture authentication failed');" +
        code,
    ]);
  }
  config(mode, overrides = {}) {
    return {
      NODE_ENV: mode,
      PORT: '3001',
      LOG_LEVEL: 'info',
      MONGODB_URI: `mongodb://${this.credentials.mongoUser}:${this.credentials.mongoPassword}@mongo:27017/totmart_b_${this.run.replaceAll('-', '')}?replicaSet=a&authSource=admin`,
      REDIS_URL: `redis://:${this.credentials.redisPassword}@redis:6379/0`,
      REDIS_NAMESPACE: `totmart:b:${this.run}`,
      JWT_SECRET: this.credentials.jwt,
      JWT_REFRESH_SECRET: this.credentials.refresh,
      CLOUDINARY_CLOUD_NAME: 'fixture-cloud',
      CLOUDINARY_API_KEY: 'fixture-cloud-key',
      CLOUDINARY_API_SECRET: randomBytes(24).toString('hex'),
      SEPAY_API_KEY: this.credentials.sepay,
      SEPAY_BANK_ACCOUNT: '0000012345',
      SEPAY_BANK_NAME: 'Fixture Bank',
      FRONTEND_URL: 'https://app.totmart.test',
      CORS_ORIGINS: 'https://app.totmart.test',
      TRUST_PROXY: '1',
      ...overrides,
    };
  }
  backend(role, env, command = []) {
    return this.create(
      role,
      candidate.image.id,
      ['--network-alias', role, '--tmpfs', '/tmp', '--tmpfs', '/fixture:mode=1777'],
      command,
      env,
    );
  }
  health(id) {
    if (!this.verify(id).state.Running) return false;
    try {
      return (
        this.exec(
          id,
          [
            'node',
            '-e',
            "fetch('http://127.0.0.1:3001/api/home/health',{signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(2))",
          ],
          5000,
        ) === '200'
      );
    } catch {
      return false;
    }
  }
  async cleanup() {
    let code = 0;
    for (const resource of this.resources.toReversed()) {
      if (resource.cleaned) continue;
      try {
        const info = this.verify(resource.id);
        if (resource.type === 'container') {
          if (info.state.Paused) this.docker(['unpause', resource.id]);
          if (info.state.Running && resource.image === candidate.image.id)
            this.docker(['stop', '--time', '15', resource.id], 20000);
          this.docker(['rm', '-f', resource.id]);
        } else this.docker(['network', 'rm', resource.id]);
        resource.cleaned = true;
      } catch {
        code = 1;
      }
      this.record();
    }
    const containers = new Set(
      this.docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    const networks = new Set(
      this.docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    for (const resource of this.resources) {
      resource.absent = !(resource.type === 'container' ? containers : networks).has(resource.id);
      if (!resource.absent) code = 1;
    }
    this.record();
    return code;
  }
}
module.exports = { Lease, candidate, delay };
