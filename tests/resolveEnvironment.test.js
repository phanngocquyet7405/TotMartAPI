const {
  resolveEnvironment,
  assertServerConfig,
  boolean,
} = require('../src/config/resolveEnvironment');
const fixture = () => ({
  NODE_ENV: 'test',
  JWT_SECRET: 'fixture-auth-key',
  JWT_REFRESH_SECRET: 'fixture-refresh-key',
});
test('pure resolver does not read ambient env, load dotenv or connect; result is immutable', () => {
  const dotenv = jest.spyOn(require('dotenv'), 'config');
  const connect = jest.spyOn(require('mongoose'), 'connect');
  const config = resolveEnvironment(fixture());
  expect(config.jwt.expiresIn).toBe('15m');
  expect(Object.isFrozen(config) && Object.isFrozen(config.jwt)).toBe(true);
  expect(dotenv).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
  dotenv.mockRestore();
  connect.mockRestore();
});
test.each(['production', 'staging'])(
  '%s retains strict admission, separate secrets and no sid fallback',
  (nodeEnv) => {
    const env = {
      NODE_ENV: nodeEnv,
      JWT_SECRET: 'fixture-auth-key-with-diverse-characters-12345',
      JWT_REFRESH_SECRET: 'fixture-refresh-key-with-other-characters-67890',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/disposable',
      FRONTEND_URL: 'https://fixture.invalid',
      SEPAY_API_KEY: 'fixture-api-key',
      SEPAY_BANK_ACCOUNT: '0000000000',
      SEPAY_BANK_NAME: 'Fixture',
      REDIS_URL: 'rediss://127.0.0.1:6379',
      REDIS_NAMESPACE: 'fixture:strict',
      TRUST_PROXY: '1',
    };
    expect(resolveEnvironment(env).strictSessions).toBe(true);
    for (const key of ['JWT_REFRESH_SECRET', 'REDIS_URL', 'MONGODB_URI', 'TRUST_PROXY']) {
      const invalid = { ...env };
      delete invalid[key];
      expect(() => resolveEnvironment(invalid)).toThrow(/Missing required/);
      expect(() => resolveEnvironment({ ...env, [key]: '' })).toThrow(/Invalid configuration/);
    }
    expect(() => resolveEnvironment({ ...env, REDIS_URL: 'redis://127.0.0.1:6379' })).toThrow();
    expect(() => resolveEnvironment({ ...env, JWT_REFRESH_SECRET: env.JWT_SECRET })).toThrow();
  },
);
test.each([
  ['NODE_ENV', 'invalid'],
  ['PORT', '0'],
  ['PORT', '3.5'],
  ['ORDER_EXPIRY_HOURS', '-1'],
  ['BCRYPT_COST', '9'],
  ['BCRYPT_COST', '12.5'],
  ['JWT_EXPIRES_IN', '900'],
  ['JWT_EXPIRES_IN', '0s'],
  ['JWT_EXPIRES_IN', '0.5ms'],
  ['TRUST_PROXY', 'true'],
  ['LOG_LEVEL', 'verbose'],
  ['REDIS_URL', 'https://invalid'],
  ['MONGODB_URI', 'https://invalid'],
  ['FRONTEND_URL', 'https://fixture.invalid/path'],
  ['CORS_ORIGINS', 'https://ok.invalid,'],
])('rejects invalid %s without echoing values', (key, value) => {
  expect(() => resolveEnvironment({ ...fixture(), [key]: value })).toThrow(new RegExp(key));
});
test('missing, empty and invalid values remain distinguishable; explicit empty Redis only disables local mode', () => {
  expect(resolveEnvironment(fixture()).port).toBe(3001);
  expect(() => resolveEnvironment({ ...fixture(), PORT: '' })).toThrow(/empty/);
  expect(() => resolveEnvironment({ ...fixture(), PORT: 'invalid' })).toThrow(/number/);
  expect(resolveEnvironment({ ...fixture(), REDIS_URL: '' }).redis.url).toBeUndefined();
  expect(() => assertServerConfig(resolveEnvironment(fixture()))).toThrow(
    /Missing required server/,
  );
});
test('Mongo replica seed lists and SRV URLs retain supported URL forms', () => {
  for (const uri of [
    'mongodb://127.0.0.1:27017,127.0.0.1:27018/db?replicaSet=fixture',
    'mongodb+srv://fixture.invalid/db',
  ]) {
    expect(resolveEnvironment({ ...fixture(), MONGODB_URI: uri }).mongodb.uri === uri).toBe(true);
  }
  for (const uri of ['mongodb://', 'mongodb+srv://host:27017/db', 'mongodb://host/db#fragment']) {
    expect(() => resolveEnvironment({ ...fixture(), MONGODB_URI: uri })).toThrow(/MONGODB_URI/);
  }
});
test.each([
  ['true', true],
  ['1', true],
  ['false', false],
  ['0', false],
])('boolean %s', (value, expected) => {
  expect(boolean({ CI: value }, 'CI')).toBe(expected);
});
test('boolean missing/empty/invalid and credential URI errors are safe', () => {
  expect(boolean({}, 'CI')).toBe(false);
  for (const value of ['', 'yes']) expect(() => boolean({ CI: value }, 'CI')).toThrow();
  const marker = 'private-fixture-sentinel';
  for (const key of ['FRONTEND_URL', 'REDIS_URL', 'MONGODB_URI']) {
    let message;
    try {
      resolveEnvironment({
        ...fixture(),
        [key]: 'invalid://' + marker + ':hidden@fixture.invalid',
      });
    } catch (error) {
      message = error.message;
    }
    expect(Boolean(message) && !message.includes(marker) && !message.includes('hidden')).toBe(true);
  }
});
test.each(['15m', '900s', '1h', '0.5h'])(
  'issued access JWT matches configured lifetime %s',
  (lifetime) => {
    const config = resolveEnvironment({ ...fixture(), JWT_EXPIRES_IN: lifetime });
    jest.isolateModules(() => {
      jest.doMock('../src/config/environment', () => config);
      const jwt = require('jsonwebtoken');
      const token = require('../src/services/sessionService').accessToken(
        { _id: 'fixture-user', tokenVersion: 0 },
        'fixture-family',
      );
      const decoded = jwt.verify(token, config.jwt.secret);
      expect(decoded.exp - decoded.iat).toBe(config.jwt.accessSeconds);
    });
    jest.dontMock('../src/config/environment');
  },
);
