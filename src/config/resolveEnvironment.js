const { validateProductionEnv } = require('./environmentChecks');
const invalid = (key, reason) => {
  throw new Error(`Invalid configuration: ${key} (${reason})`);
};
function text(env, key, fallback) {
  if (env[key] === undefined) return fallback;
  if (typeof env[key] !== 'string' || env[key].trim() === '') invalid(key, 'empty or non-string');
  return env[key];
}
function number(env, key, fallback, min, max) {
  const value = text(env, key, String(fallback));
  if (
    !/^\d+(?:\.\d+)?$/.test(value) ||
    !Number.isFinite(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    invalid(key, `number from ${min} to ${max} required`);
  return Number(value);
}
function boolean(env, key, fallback = false) {
  if (env[key] === undefined) return fallback;
  if (env[key] === 'true' || env[key] === '1') return true;
  if (env[key] === 'false' || env[key] === '0') return false;
  return invalid(key, 'expected true/false/1/0');
}
function duration(env, key, fallback) {
  const value = text(env, key, fallback),
    match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value);
  const seconds =
    match && Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    invalid(key, 'positive whole seconds with explicit ms/s/m/h/d/w unit required');
  return { value, seconds };
}
function url(value, key, protocols, origin = false) {
  if (value === undefined) return;
  try {
    if (protocols.includes('mongodb:')) {
      const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)([^#]*)$/.exec(value);
      if (!match) invalid(key, 'MongoDB URL shape');
      const authority = match[2],
        hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',');
      if (authority.includes('@'))
        decodeURIComponent(authority.slice(0, authority.lastIndexOf('@')));
      if (match[1] === 'mongodb+srv' && hosts.length !== 1) invalid(key, 'SRV seed count');
      for (const host of hosts) {
        const parsedHost = new URL('http://' + host);
        if (
          !parsedHost.hostname ||
          parsedHost.username ||
          parsedHost.password ||
          (match[1] === 'mongodb+srv' && parsedHost.port)
        )
          invalid(key, 'MongoDB host shape');
      }
      return;
    }
    const parsed = new URL(value);
    if (
      !protocols.includes(parsed.protocol) ||
      !parsed.hostname ||
      (origin &&
        (parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash ||
          !['', '/'].includes(parsed.pathname)))
    )
      invalid(key, 'URL shape');
    if (
      protocols.includes('redis:') &&
      (!/^\/(?:\d+)?$|^$/.test(parsed.pathname) ||
        parsed.search ||
        parsed.hash ||
        parsed.port === '0')
    )
      invalid(key, 'Redis URL shape');
  } catch {
    invalid(key, 'URL shape');
  }
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function resolveEnvironment(env) {
  const nodeEnv = text(env, 'NODE_ENV', 'development');
  if (!['development', 'test', 'staging', 'production'].includes(nodeEnv))
    invalid('NODE_ENV', 'enum');
  const strictSessions = ['production', 'staging'].includes(nodeEnv);
  const required = strictSessions
    ? [
        'JWT_SECRET',
        'JWT_REFRESH_SECRET',
        'MONGODB_URI',
        'FRONTEND_URL',
        'SEPAY_API_KEY',
        'SEPAY_BANK_ACCOUNT',
        'SEPAY_BANK_NAME',
        'REDIS_URL',
        'REDIS_NAMESPACE',
        'TRUST_PROXY',
      ]
    : [];
  const missing = required.filter((key) => env[key] === undefined);
  if (missing.length)
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const access = duration(env, 'JWT_EXPIRES_IN', '15m');
  const config = {
    nodeEnv,
    strictSessions,
    ci: boolean(env, 'CI'),
    port: number(env, 'PORT', 3001, 1, 65535),
    mongodb: { uri: text(env, 'MONGODB_URI', 'mongodb://localhost:27017/totmart?replicaSet=rs0') },
    jwt: {
      secret: text(env, 'JWT_SECRET', 'your-secret-key-change-in-production'),
      expiresIn: access.value,
      accessSeconds: access.seconds,
      refreshSecret: text(env, 'JWT_REFRESH_SECRET', 'your-refresh-secret-change-in-production'),
      refreshExpiresIn: duration(env, 'JWT_REFRESH_EXPIRES_IN', '30d').value,
      legacyAccessExpiresIn: duration(env, 'JWT_ACCESS_EXPIRES_IN', '30m').value,
      legacyRefreshExpiresIn: duration(env, 'JWT_REFRESH_EXPIRES_IN', '7d').value,
    },
    frontendUrl: text(env, 'FRONTEND_URL', 'http://localhost:3000'),
    corsOrigins: text(env, 'CORS_ORIGINS', env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')
      .map((value) => value.trim().replace(/\/+$/, '')),
    trustProxy: text(env, 'TRUST_PROXY', '0'),
    redis: {
      url: env.REDIS_URL === '' && !strictSessions ? undefined : text(env, 'REDIS_URL'),
      namespace: text(env, 'REDIS_NAMESPACE', 'totmart:development'),
    },
    sepay: {
      apiKey: text(env, 'SEPAY_API_KEY'),
      bankAccount: text(env, 'SEPAY_BANK_ACCOUNT'),
      bankName: text(env, 'SEPAY_BANK_NAME'),
    },
    cloudinary: {
      cloud_name: text(env, 'CLOUDINARY_CLOUD_NAME'),
      api_key: text(env, 'CLOUDINARY_API_KEY'),
      api_secret: text(env, 'CLOUDINARY_API_SECRET'),
      secure: true,
    },
    email: { apiKey: text(env, 'BREVO_API_KEY'), from: text(env, 'FROM_EMAIL') },
    orderExpiryHours: number(env, 'ORDER_EXPIRY_HOURS', 24, Number.MIN_VALUE, 2400000000),
    checkoutSessionExpiryMinutes: number(env, 'CHECKOUT_SESSION_EXPIRY_MINUTES', 15, 5, 60),
    bcryptCost: number(env, 'BCRYPT_COST', 12, 10, 15),
    logLevel: text(env, 'LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
    provided: Object.fromEntries(
      Object.keys(env).map((key) => [key, env[key] !== undefined && env[key] !== '']),
    ),
  };
  config.jwt.legacyRefreshSecret = env.JWT_REFRESH_SECRET ?? config.jwt.secret;
  if (!Number.isInteger(config.port)) invalid('PORT', 'integer required');
  if (!Number.isInteger(config.bcryptCost))
    invalid('BCRYPT_COST', 'integer from 10 to 15 required');
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(config.logLevel))
    invalid('LOG_LEVEL', 'enum');
  if (!/^(0|1|loopback|linklocal|uniquelocal)$/.test(config.trustProxy))
    invalid('TRUST_PROXY', 'enum');
  if (!/^[a-z0-9:_-]{3,80}$/i.test(config.redis.namespace)) invalid('REDIS_NAMESPACE', 'shape');
  url(config.mongodb.uri, 'MONGODB_URI', ['mongodb:', 'mongodb+srv:']);
  url(config.redis.url, 'REDIS_URL', ['redis:', 'rediss:']);
  url(config.frontendUrl, 'FRONTEND_URL', ['http:', 'https:'], true);
  config.corsOrigins.forEach((value) => url(value, 'CORS_ORIGINS', ['http:', 'https:'], true));
  if (strictSessions) {
    const { errors } = validateProductionEnv(env);
    if (errors.length)
      throw new Error(
        'Invalid production/staging configuration: ' +
          errors.map((error) => error.split(' ')[0]).join(', '),
      );
  }
  return freeze(config);
}
function assertServerConfig(config) {
  const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'SEPAY_API_KEY',
    'SEPAY_BANK_ACCOUNT',
  ];
  const missing = required.filter((key) => !config.provided[key]);
  if (missing.length)
    throw new Error('Missing required server configuration: ' + missing.join(', '));
  return config;
}
module.exports = { resolveEnvironment, assertServerConfig, boolean };
