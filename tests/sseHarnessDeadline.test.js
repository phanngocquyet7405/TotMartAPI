const {
  faultControl,
  waitUntil,
  remoteClosure,
  watcherExit,
  boundedReadFailure,
} = require('./helpers/roundC2/sse-deadline');
const control = { faultAt: 1000, deadlineAt: 66000 };

test.each([30000, 60000])('lease wait respects fixture expiry after %i ms', async (leaseMs) => {
  let fixtureNow = 1000000;
  const expiresAt = fixtureNow + leaseMs + 100;
  // A host clock ahead of the fixture would skip this wait entirely.
  const hostNow = fixtureNow + 120000;
  expect(hostNow > expiresAt).toBe(true);
  const observedAt = await waitUntil(
    expiresAt,
    () => fixtureNow,
    async (ms) => {
      expect(fixtureNow < expiresAt).toBe(true);
      fixtureNow += ms;
    },
  );
  expect(observedAt >= expiresAt).toBe(true);
});

test.each([120000, -120000])(
  'fault control uses the watcher clock despite host skew %i ms',
  (hostSkew) => {
    const fixtureAt = 1000000;
    const fixtureControl = faultControl('fixture-run', () => fixtureAt);
    const ended = { endAt: fixtureAt + 5000 };
    const hostControl = {
      faultAt: fixtureAt + hostSkew,
      deadlineAt: fixtureAt + hostSkew + 65000,
    };
    expect(remoteClosure(ended, hostControl)).toBe(false);
    expect(remoteClosure(ended, fixtureControl)).toBe(true);
    expect(remoteClosure({ endAt: fixtureAt + 65001 }, fixtureControl)).toBe(false);
  },
);
test('SSE gate accepts remote end within 65s of fault even if local cleanup follows', () =>
  expect(remoteClosure({ endAt: 26000, localDestroyAt: 27000 }, control)).toBe(true));
test.each([
  { closeAt: 25000 },
  { endAt: 66001 },
  { endAt: 25000, localDestroyAt: 20000 },
  { endAt: 25000, abortedAt: 24000 },
  { endAt: 500 },
])('SSE gate refuses non-remote or out-of-window closure %j', (state) =>
  expect(remoteClosure(state, control)).toBe(false),
);
test('SSE gate refuses a shifted epoch', () =>
  expect(remoteClosure({ endAt: 25000 }, { faultAt: 1000, deadlineAt: 94000 })).toBe(false));
test.each([
  [0, []],
  [0, [{ passed: false }]],
  [1, [{ passed: true }]],
  [0, [{ passed: true }, { passed: true }]],
])('watcher refuses missing/failed/duplicate output %#', (code, records) =>
  expect(watcherExit(code, records)).toBe(1),
);
test('watcher success needs one passed result and process0', () =>
  expect(watcherExit(0, [{ passed: true }])).toBe(0));

test.each(['MongoOperationTimeoutError', 'MongoServerSelectionError'])(
  'bounded failed read accepts %s',
  (errorType) =>
    expect(
      boundedReadFailure({ at: 1000, timeoutMS: 5000 }, { at: 6005, outcome: 'error', errorType }),
    ).toBe(true),
);
test.each([
  { at: 9000, outcome: 'error', errorType: 'MongoOperationTimeoutError' },
  { at: 6000, outcome: 'success' },
  { at: 6000, outcome: 'error', errorType: 'Error' },
  {},
])('bounded read refuses slow/success/missing/unclassified result %#', (end) =>
  expect(boundedReadFailure({ at: 1000, timeoutMS: 5000 }, end)).toBe(false),
);
test('bounded read refuses missing CSOT even if selection fails fast', () =>
  expect(
    boundedReadFailure(
      { at: 1000, timeoutMS: null },
      { at: 6000, outcome: 'error', errorType: 'MongoServerSelectionError' },
    ),
  ).toBe(false));
