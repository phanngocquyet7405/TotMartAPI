const { EventEmitter } = require('node:events');
const path = require('node:path');
const { crashMigrationChild } = require('./helpers/roundC1/crash-barrier');
const { withRedisBystander } = require('./helpers/redis-bystander');

function migrationChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: jest.fn(() => true),
  });
  const launch = jest.fn(() => child);
  const start = () =>
    crashMigrationChild({
      directory: path.resolve('artifacts/round-c1/00000000-0000-4000-8000-000000000001'),
      uri: 'mongodb://127.0.0.1:1/totmart_c1_migration_fixture',
      launch,
    });
  const close = (code = null, signal = 'SIGKILL') => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('close', code, signal);
  };
  return { child, launch, start, close };
}
afterEach(() => jest.useRealTimers());

test('migration child receives parent identity and resolves only after exact child is closed', async () => {
  jest.useFakeTimers();
  const f = migrationChild(),
    pending = f.start();
  expect(f.launch.mock.calls[0][2].env.C1_DIRECTORY).toBe(
    path.resolve('artifacts/round-c1/00000000-0000-4000-8000-000000000001'),
  );
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  f.child.emit('message', { event: 'first-write-held' });
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  await Promise.resolve();
  expect(settled).toBe(false);
  f.close();
  await expect(pending).resolves.toMatchObject({
    pid: 123,
    barrier: 'first-write-held',
    exactChildHandle: true,
  });
  expect(jest.getTimerCount()).toBe(0);
});

test('migration child early exit rejects immediately instead of waiting 30 seconds', async () => {
  jest.useFakeTimers();
  const f = migrationChild(),
    pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/exited before crash barrier/);
  f.close(1, null);
  await rejected;
  expect(f.child.kill).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('migration barrier timeout kills its exact child and waits for cleanup', async () => {
  jest.useFakeTimers();
  const f = migrationChild(),
    pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/barrier deadline/);
  jest.advanceTimersByTime(30000);
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  f.close();
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});

test('migration process error is retained and cleaned before rejection', async () => {
  jest.useFakeTimers();
  const f = migrationChild(),
    pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/spawn\/process failure/);
  f.child.emit('error', new Error('synthetic spawn error'));
  f.close(1, null);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});

test('migration missing close is a cleanup failure, never a successful crash observation', async () => {
  jest.useFakeTimers();
  const f = migrationChild(),
    pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/cleanup deadline/);
  f.child.emit('message', { event: 'first-write-held' });
  jest.advanceTimersByTime(5000);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});

test.each([undefined, '', 'redis://remote.test:1234/15', 'redis://127.0.0.1:1234/15'])(
  'Redis prerequisite %s is refused before constructing or connecting any client',
  async (url) => {
    const makeClient = jest.fn(),
      work = jest.fn();
    await expect(
      withRedisBystander(url, 'redis://127.0.0.1:1234/15', work, makeClient),
    ).rejects.toThrow();
    expect(makeClient).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  },
);

test.each(['success', 'connect-error', 'work-error'])(
  'Redis bystander cleanup after %s',
  async (mode) => {
    const client = {
      isOpen: false,
      on: jest.fn(),
      connect: jest.fn(async () => {
        client.isOpen = true;
        if (mode === 'connect-error') throw new Error('synthetic connect failure');
      }),
      destroy: jest.fn(() => {
        client.isOpen = false;
      }),
    };
    const work = jest.fn(async () => {
      if (mode === 'work-error') throw new Error('synthetic work failure');
      return 'observed';
    });
    const pending = withRedisBystander(
      'redis://127.0.0.1:1235/15',
      'redis://127.0.0.1:1234/15',
      work,
      () => client,
    );
    if (mode === 'success') await expect(pending).resolves.toBe('observed');
    else await expect(pending).rejects.toThrow(/synthetic .* failure/);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  },
);
