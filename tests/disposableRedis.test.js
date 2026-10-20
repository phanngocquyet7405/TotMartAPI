const { disposableRedis } = require('./helpers/disposableRedis');
function fakeDocker() {
  const id = 'a'.repeat(64);
  let info;
  const run = jest.fn(args => {
    switch (args[0]) {
      case 'create':
        const port = args[args.indexOf('--publish') + 1].split(':')[1];
        info = { Id: id, Name: '/' + args[args.indexOf('--name') + 1],
          Config: { Labels: { 'totmart.test.run': args[args.indexOf('--label') + 1].split('=')[1] } },
          State: { Running: false, Paused: false },
          HostConfig: { PortBindings: { '6379/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } },
          NetworkSettings: { Ports: { '6379/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } } };
        return id;
      case 'inspect': return JSON.stringify([info]);
      case 'start': info.State.Running = true; info.NetworkSettings.Ports = structuredClone(info.HostConfig.PortBindings); return id;
      case 'stop': info.State.Running = false; info.NetworkSettings.Ports = {}; return id;
      case 'pause': info.State.Paused = true; info.NetworkSettings.Ports = {}; return id;
      case 'unpause': info.State.Paused = false; info.NetworkSettings.Ports = structuredClone(info.HostConfig.PortBindings); return id;
      case 'exec': return 'PONG';
      case 'rm': return id;
      default: throw new Error('Unexpected Docker operation');
    }
  });
  return { run, get info() { return info; } };
}
test('owns exact ID/label, maps /15 and unpauses before cleanup; cleanup is idempotent', async () => {
  const fake = fakeDocker(), redis = await disposableRedis({ run: fake.run });
  expect(redis.url).toMatch(/^redis:\/\/127\.0\.0\.1:\d+\/15$/);
  redis.action('stop'); redis.action('start'); redis.action('pause'); redis.cleanup(); redis.cleanup();
  const mutations = fake.run.mock.calls.map(([args]) => args).filter(args => ['stop', 'start', 'pause', 'unpause', 'rm'].includes(args[0]));
  expect(mutations.map(args => args[0])).toEqual(['start', 'stop', 'start', 'pause', 'unpause', 'rm']);
  expect(mutations.every(args => args.at(-1) === 'a'.repeat(64))).toBe(true);
});
test.each(['id', 'label', 'mapping', 'binding'])('refuses mutation after %s mismatch', async kind => {
  const fake = fakeDocker(), redis = await disposableRedis({ run: fake.run });
  if (kind === 'id') fake.info.Id = 'b'.repeat(64);
  if (kind === 'label') fake.info.Config.Labels['totmart.test.run'] = 'other-run';
  if (kind === 'mapping') fake.info.NetworkSettings.Ports['6379/tcp'][0].HostPort = '6379';
  if (kind === 'binding') fake.info.HostConfig.PortBindings['6379/tcp'][0].HostIp = '0.0.0.0';
  fake.run.mockClear();
  expect(() => redis.action('stop')).toThrow(/mismatch/);
  expect(fake.run.mock.calls.every(([args]) => args[0] === 'inspect')).toBe(true);
});
test('cleans up its container when startup fails and retains original error', async () => {
  const fake = fakeDocker(), original = new Error('startup failure');
  const run = jest.fn(args => { if (args[0] === 'start') throw original; return fake.run(args); });
  await expect(disposableRedis({ run })).rejects.toBe(original);
  expect(run.mock.calls.some(([args]) => args[0] === 'rm' && args[2] === 'a'.repeat(64))).toBe(true);
});
test('recovers ID after a create client timeout and removes only its own resource', async () => {
  const fake = fakeDocker(), original = new Error('create client timeout');
  const run = jest.fn(args => { const result = fake.run(args); if (args[0] === 'create') throw original; return result; });
  await expect(disposableRedis({ run })).rejects.toBe(original);
  expect(run.mock.calls.some(([args]) => args[0] === 'rm' && args[2] === 'a'.repeat(64))).toBe(true);
});
test('cleanup failure never replaces the startup error', async () => {
  const fake = fakeDocker(), original = new Error('startup failure');
  const run = args => { if (args[0] === 'start') throw original; if (args[0] === 'rm') throw new Error('cleanup failure'); return fake.run(args); };
  await expect(disposableRedis({ run })).rejects.toBe(original);
  expect(original.cleanupError.message).toBe('cleanup failure');
});
test('independent leases refuse a different suite container', async () => {
  const first = fakeDocker(), second = fakeDocker();
  const a = await disposableRedis({ run: first.run });
  const b = await disposableRedis({ run: second.run });
  expect(first.info.Config.Labels).not.toEqual(second.info.Config.Labels);
  first.info.Config.Labels = second.info.Config.Labels;
  expect(() => a.action('pause')).toThrow('ownership mismatch');
  b.cleanup();
});
