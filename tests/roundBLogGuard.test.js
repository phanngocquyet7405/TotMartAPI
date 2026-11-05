const { inspectPublishedLogs } = require('./helpers/roundA/disclosure-guard');
const id = '17be2618-d571-4028-b0aa-f095595b6262';
const log = () => ({
  msg: 'request errored',
  req: { id },
  err: { type: 'Error', code: 'ECONNRESET' },
});
test('accepts safe type/code and a correlated pino-http record', () => {
  expect(inspectPublishedLogs([log()], { requestIds: [id] })).toEqual([]);
});
test.each(['stack', 'message', 'cause', 'response'])(
  'rejects a pino-http error %s, including nested provider fields',
  (field) => {
    const value = log();
    value.err[field] = { private: 'SYNTHETIC_DISCLOSURE_LOG' };
    expect(
      inspectPublishedLogs([value], { markers: ['SYNTHETIC_DISCLOSURE_LOG'], requestIds: [id] })
        .length,
    ).toBeGreaterThan(0);
  },
);
test.each([
  'mongodb://fixture:synthetic@mongo/db',
  'at onResFinished (/app/node_modules/pino-http/logger.js:12:3)',
  'SYNTHETIC_DISCLOSURE_LOG',
])('scans every published log field for URI/frame/marker', (value) =>
  expect(
    inspectPublishedLogs([{ ...log(), extra: value }], { markers: ['SYNTHETIC_DISCLOSURE_LOG'] })
      .length,
  ).toBeGreaterThan(0),
);
test('requires automatic log requestId correlation', () => {
  const value = log();
  delete value.req.id;
  expect(inspectPublishedLogs([value], { requestIds: [id] }).length).toBeGreaterThan(0);
});
