// Redis's default database count is 16 for the disposable test image.
// Reject ambiguous URLs before URL normalization (credentials, escapes, aliases).
function localRedisUrl(value) {
  const match = typeof value === 'string' && /^redis:\/\/(127\.0\.0\.1|localhost):([1-9]\d{0,4})(?:\/(0|[1-9]\d*))?$/.exec(value);
  if (!match || Number(match[2]) > 65535 || Number(match[3] || 0) > 15) {
    throw new Error('Test Redis requires redis://localhost-or-127.0.0.1:port with optional database 0..15; credentials and URL options are forbidden');
  }
  return { host: match[1], port: Number(match[2]), database: Number(match[3] || 0) };
}
module.exports = { localRedisUrl };
