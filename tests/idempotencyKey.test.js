const key = require('../src/utils/idempotencyKey');
test('production rejects missing key before financial writes', () => {
  expect(() => key({headers:{}},true)).toThrow('Idempotency-Key');
});
test('production preserves client identity, rejects malformed keys', () => {
  const id='dba8f313-1c27-42fa-9f66-5c99b1f35202';
  expect(key({headers:{'idempotency-key':id}},true)).toBe(id);
  expect(() => key({headers:{'idempotency-key':'bad'}},true)).toThrow('Idempotency-Key');
});
test('development retains backwards-compatible generated UUID', () => {
  expect(key({headers:{}},false)).toMatch(/^[a-f0-9-]{36}$/);
});
