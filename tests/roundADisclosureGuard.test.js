const { inspectMongoResponse } = require('./helpers/roundA/disclosure-guard');
const requestId = '17be2618-d571-4028-b0aa-f095595b6262';
const response = () => ({
  status: 503,
  headers: { 'x-request-id': requestId },
  body: {
    success: false,
    status: 503,
    message: 'Lỗi hệ thống. Vui lòng thử lại.',
    requestId,
  },
});
test('accepts the safe login envelope and matching request IDs', () => {
  expect(inspectMongoResponse(response(), { login: true })).toEqual([]);
});
test('allows a dependency label in readiness without treating it as a raw Mongo error', () => {
  const value = {
    status: 503,
    headers: { 'x-request-id': requestId },
    body: { success: false, status: 'not_ready', dependency: 'MongoDB' },
  };
  expect(inspectMongoResponse(value)).toEqual([]);
});
test.each([
  'mongodb://fixture:synthetic@mongo:27017/test',
  'mongodb+srv://mongo.test/test',
  'MongoServerSelectionError: private host',
  'MongoNetworkError: private host',
  'MongooseError: private field',
  'Operation users.findOne() buffering timed out',
  'at read (/app/private.js:12:3)',
  'SYNTHETIC_DISCLOSURE_MARKER',
])('rejects error content, stack, URI and marker: %s', (marker) => {
  const value = {
    status: 503,
    headers: { 'x-request-id': requestId },
    body: { status: 'not_ready', detail: marker },
  };
  expect(
    inspectMongoResponse(value, { markers: ['SYNTHETIC_DISCLOSURE_MARKER'] }).length,
  ).toBeGreaterThan(0);
});
test.each(['header', 'body', 'mismatch', 'message', 'extra', 'status'])(
  'rejects a broken login %s invariant',
  (field) => {
    const value = response();
    if (field === 'header') delete value.headers['x-request-id'];
    if (field === 'body') delete value.body.requestId;
    if (field === 'mismatch') value.body.requestId = '27be2618-d571-4028-b0aa-f095595b6262';
    if (field === 'message') value.body.message = 'Private database detail';
    if (field === 'extra') value.body.error = { cause: 'Private database detail' };
    if (field === 'status') value.status = 401;
    expect(inspectMongoResponse(value, { login: true }).length).toBeGreaterThan(0);
  },
);
test('reports transport timeout distinctly and never treats it as a safe response', () => {
  expect(inspectMongoResponse({ status: 0, timedOut: true }, { login: true })).toEqual([
    'transport failure before HTTP response',
  ]);
});
