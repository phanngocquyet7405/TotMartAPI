// Che các giá trị nhạy cảm trong URL và query trước khi ghi log.
// Token đặt lại mật khẩu và vé SSE đi trong query string; nếu ghi nguyên URL
// thì ai đọc được log có thể dùng lại chúng trước khi hết hạn.
const pino = require('pino');

const SENSITIVE_QUERY_KEYS = new Set([
  'token', 'ticket', 'access_token', 'refresh_token', 'id_token', 'code',
  'password', 'secret', 'api_key', 'apikey', 'key', 'signature', 'sig', 'otp',
]);
const REDACTED = '[REDACTED]';

function isSensitiveKey(rawKey) {
  let key = String(rawKey);
  try { key = decodeURIComponent(key); } catch { /* giữ nguyên khóa thô */ }
  // Kiểm tra từng đoạn khóa, gồm cả dạng lồng nhau như token[] hoặc user[token].
  return key
    .toLowerCase()
    .split(/[\[\]]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_QUERY_KEYS.has(segment));
}

function redactUrl(url) {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  const query = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      return isSensitiveKey(rawKey) ? `${rawKey}=${REDACTED}` : pair;
    })
    .join('&');
  return `${url.slice(0, q)}?${query}`;
}

function redactQueryObject(query) {
  if (!query || typeof query !== 'object') return query;
  const out = {};
  for (const [key, value] of Object.entries(query)) {
    out[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return out;
}

// Serializer cho pino-http: giữ nguyên các trường chuẩn, chỉ che URL và query.
function reqSerializer(req) {
  const serialized = pino.stdSerializers.req(req);
  if (serialized.url) serialized.url = redactUrl(serialized.url);
  if (serialized.query) serialized.query = redactQueryObject(serialized.query);
  return serialized;
}

module.exports = { redactUrl, redactQueryObject, reqSerializer, SENSITIVE_QUERY_KEYS };
