const { localRedisUrl } = require('./helpers/localRedisUrl');
test.each(['redis://127.0.0.1:6380', 'redis://localhost:65535/0', 'redis://127.0.0.1:6379/15'])('accepts local Redis %s', value => {
  expect(localRedisUrl(value).database).toBe(value.endsWith('/15') ? 15 : 0);
});
test.each([
  'redis://user:password@127.0.0.1:6379/15', 'redis://@localhost:6379',
  'redis://example.com:6379/15', 'redis://localhost.evil:6379', 'redis://127.1:6379',
  'redis://2130706433:6379', 'redis://[::1]:6379', 'rediss://localhost:6379',
  'redis://localhost:0', 'redis://localhost:65536', 'redis://localhost',
  'redis://localhost:6379/16', 'redis://localhost:6379/-1', 'redis://localhost:6379/1.5',
  'redis://localhost:6379/01', 'redis://localhost:6379/15?x=1', 'redis://localhost:6379/15#x',
  'redis://localhost:6379/../../15', 'redis://localhost:6379/%31', '', undefined,
])('rejects unsafe/unsupported local Redis URL case %#', value => {
  expect(() => localRedisUrl(value)).toThrow('Test Redis requires');
});
