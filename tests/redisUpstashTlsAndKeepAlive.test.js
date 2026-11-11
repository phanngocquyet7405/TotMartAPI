const { resolveEnvironment } = require('../src/config/resolveEnvironment');
const { validateProductionEnv } = require('../src/config/environmentChecks');
const { createClient } = require('redis');

describe('Redis Configuration: Upstash TLS, Keep-Alive & Fail-Closed (Phase 6)', () => {
  const baseFixture = () => ({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-at-least-32-chars-long',
    MONGODB_URI: 'mongodb://localhost:27017/totmart?replicaSet=rs0',
    FRONTEND_URL: 'http://localhost:3000',
  });

  describe('(a) Upstash TLS (rediss://) Connection Parsing', () => {
    test('accepts standard Upstash rediss:// URL with credentials and port', () => {
      const upstashUrl = 'rediss://default:upstash_token_12345@singapore-redis.upstash.io:6379';
      const config = resolveEnvironment({ ...baseFixture(), REDIS_URL: upstashUrl });
      expect(config.redis.url).toBe(upstashUrl);
    });

    test('accepts Upstash rediss:// URL with base64/padding (==) in password', () => {
      const upstashUrl =
        'rediss://default:AXyZ123456789ABCDEF==@huge-duckling-228694.upstash.io:6379';
      const config = resolveEnvironment({ ...baseFixture(), REDIS_URL: upstashUrl });
      expect(config.redis.url).toBe(upstashUrl);
    });

    test('production requires TLS (rediss://) and rejects plaintext redis://', () => {
      const prodEnv = {
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-secret-at-least-32-chars-long',
        JWT_REFRESH_SECRET: 'prod-refresh-secret-32-chars-long',
        MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/totmart?retryWrites=true',
        FRONTEND_URL: 'https://totmart.vn',
        SEPAY_API_KEY: 'test-sepay-key',
        SEPAY_BANK_ACCOUNT: '123456789',
        SEPAY_BANK_NAME: 'MBBank',
        REDIS_URL: 'redis://127.0.0.1:6379',
        REDIS_NAMESPACE: 'totmart:production',
        TRUST_PROXY: '1',
      };

      const { errors } = validateProductionEnv(prodEnv);
      expect(errors).toContain('REDIS_URL production phải dùng TLS rediss://');
    });

    test('node-redis parses TLS: true when rediss:// is supplied', () => {
      const upstashUrl = 'rediss://default:secret@singapore-redis.upstash.io:6379';
      const client = createClient({ url: upstashUrl });
      expect(client.options.socket.tls).toBe(true);
      expect(client.options.username).toBe('default');
      expect(client.options.password).toBe('secret');
      expect(client.options.socket.host).toBe('singapore-redis.upstash.io');
      expect(client.options.socket.port).toBe(6379);
    });
  });

  describe('(b) Redis Keep-Alive & Serverless Ping Interval', () => {
    test('defaults keepAliveMs to 30000 and pingIntervalMs to 1000', () => {
      const config = resolveEnvironment(baseFixture());
      expect(config.redis.keepAliveMs).toBe(30000);
      expect(config.redis.pingIntervalMs).toBe(1000);
    });

    test('accepts custom REDIS_KEEP_ALIVE_MS and REDIS_PING_INTERVAL_MS', () => {
      const config = resolveEnvironment({
        ...baseFixture(),
        REDIS_KEEP_ALIVE_MS: '60000',
        REDIS_PING_INTERVAL_MS: '30000',
      });
      expect(config.redis.keepAliveMs).toBe(60000);
      expect(config.redis.pingIntervalMs).toBe(30000);
    });

    test('client socket configuration includes keepAlive', () => {
      const redisModule = require('../src/config/redis');
      expect(typeof redisModule.getClient).toBe('function');
      expect(typeof redisModule.startRedis).toBe('function');
      expect(typeof redisModule.stopRedis).toBe('function');
    });
  });

  describe('(c) Fail-Closed Security Policy', () => {
    test('getClient throws 503 Shared security store unavailable when Redis is not ready', () => {
      const redisModule = require('../src/config/redis');
      expect(() => redisModule.getClient()).toThrow(/Shared security store unavailable/);
      try {
        redisModule.getClient();
      } catch (err) {
        expect(err.statusCode).toBe(503);
      }
    });

    test('ready() returns false when Redis is enabled but healthy is false', () => {
      let readyState;
      jest.isolateModules(() => {
        const fullConfig = resolveEnvironment(baseFixture());
        jest.doMock('../src/config/environment', () => ({
          ...fullConfig,
          redis: {
            ...fullConfig.redis,
            url: 'redis://127.0.0.1:6379',
            namespace: 'totmart:test',
          },
        }));
        const redisModule = require('../src/config/redis');
        readyState = redisModule.ready();
      });
      expect(readyState).toBe(false);
    });
  });
});
