jest.mock('../src/config/redis', () => ({ namespace: () => 'totmart:test', getClient: jest.fn() }));
const redis = require('../src/config/redis');
const { RedisRateLimitStore } = require('../src/services/redisRateLimitStore');
test('shared counters use distinct policy keys and server TTL', async () => {
  const evalCommand = jest.fn().mockResolvedValue([11, 2000]);
  const del = jest.fn().mockResolvedValue(1);
  redis.getClient.mockReturnValue({ eval: evalCommand, del });
  const auth = new RedisRateLimitStore('auth'), refresh = new RedisRateLimitStore('refresh');
  auth.init({windowMs:900000}); refresh.init({windowMs:60000});
  const hit = await auth.increment('127.0.0.1');
  expect(hit.totalHits).toBe(11); expect(hit.resetTime).toBeInstanceOf(Date);
  expect(evalCommand.mock.calls[0][1]).toEqual({keys:['totmart:test:limit:auth:127.0.0.1'],arguments:['900000']});
  await refresh.increment('127.0.0.1');
  expect(evalCommand.mock.calls[1][1]).toEqual({keys:['totmart:test:limit:refresh:127.0.0.1'],arguments:['60000']});
  await auth.resetKey('127.0.0.1'); expect(del).toHaveBeenCalledWith('totmart:test:limit:auth:127.0.0.1');
});
test('Redis outage fails closed instead of allowing a request', async () => {
  redis.getClient.mockImplementation(() => {throw Object.assign(new Error('Unavailable'),{statusCode:503});});
  const store = new RedisRateLimitStore('auth'); store.init({windowMs:1000});
  await expect(store.increment('ip')).rejects.toMatchObject({statusCode:503});
});
