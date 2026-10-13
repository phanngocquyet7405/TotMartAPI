// Fail startup for unsafe production configuration; never print secret values.
const PLACEHOLDER_PATTERNS = [
  /your[-_ ]/i,
  /change[-_ ]?(me|in)/i,
  /replace[-_ ]?me/i,
  /placeholder/i,
  /example/i,
  /xxxx/i,
  /username:password/i,
  /database-name/i,
  /[<>]/,
];

const looksLikePlaceholder = (value) =>
  PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(String(value)));

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && (url.pathname === '/' || url.pathname === '') &&
      !/^(localhost(?:\.|$)|127\.|0\.0\.0\.0$|\[::1\]$)/.test(url.hostname);
  } catch {
    return false;
  }
}

function validateProductionEnv(env) {
  const errors = [];
  const warnings = [];

  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SEPAY_API_KEY']) {
    if (env[key] && looksLikePlaceholder(env[key])) {
      errors.push(`${key} đang là giá trị mẫu, hãy đặt giá trị thật`);
    }
  }
  // Chuỗi kết nối chỉ kiểm các mẫu cụ thể để không báo nhầm tên cluster/database thật.
  if (env.MONGODB_URI && /username:password|database-name|[<>]|your[-_ ]/i.test(env.MONGODB_URI)) {
    errors.push('MONGODB_URI đang là giá trị mẫu, hãy đặt giá trị thật');
  }

  const origins = [env.FRONTEND_URL, ...String(env.CORS_ORIGINS || '').split(',')]
    .map((value) => (value || '').trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (!isHttpsUrl(origin)) {
      errors.push(`Origin "${origin}" phải là URL https và không phải localhost`);
    }
  }

  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (env[key] && !looksLikePlaceholder(env[key]) && String(env[key]).length < 32) {
      errors.push(`${key} phải có ít nhất 32 ký tự ngẫu nhiên`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push('JWT_SECRET và JWT_REFRESH_SECRET phải khác nhau');
  }

  if (env.REDIS_URL && !/^rediss:\/\//.test(env.REDIS_URL)) errors.push('REDIS_URL production phải dùng TLS rediss://');
  if (env.REDIS_NAMESPACE && !/^[a-z0-9:_-]{3,80}$/i.test(env.REDIS_NAMESPACE)) errors.push('REDIS_NAMESPACE không hợp lệ');
  if (env.TRUST_PROXY !== undefined && !/^(0|1|loopback|linklocal|uniquelocal)$/.test(env.TRUST_PROXY)) errors.push('TRUST_PROXY phải là 0/1 hoặc loopback/linklocal/uniquelocal');
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) if (env[key] && new Set(env[key]).size < 8) errors.push(`${key} quá dễ đoán`);
  return { errors, warnings };
}

module.exports = { validateProductionEnv, looksLikePlaceholder };
