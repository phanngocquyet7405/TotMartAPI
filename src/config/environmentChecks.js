// Kiểm tra cấu hình production: giá trị mẫu/không an toàn là lỗi, các điểm yếu
// khác chỉ cảnh báo (tránh làm sập dịch vụ đang chạy chỉ vì một giá trị cũ).
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
    return url.protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0)/.test(url.hostname);
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
      warnings.push(`${key} ngắn hơn 32 ký tự, nên đổi sang chuỗi ngẫu nhiên dài hơn`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    warnings.push('JWT_SECRET và JWT_REFRESH_SECRET đang trùng nhau, nên dùng hai giá trị khác nhau');
  }

  return { errors, warnings };
}

module.exports = { validateProductionEnv, looksLikePlaceholder };
