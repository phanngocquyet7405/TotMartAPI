const safeMessage = 'Lỗi hệ thống. Vui lòng thử lại.';
const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function inspectMongoResponse(value, { login = false, markers = [] } = {}) {
  if (!value.status) return ['transport failure before HTTP response'];
  const failures = [];
  const id = value.headers?.['x-request-id'];
  if (!requestIdPattern.test(id || '')) failures.push('missing or invalid X-Request-Id');
  const published = JSON.stringify(value);
  if (
    /mongodb(?:\+srv)?:\/\/|Mongo(?:ServerSelection|Network|NetworkTimeout|OperationTimeout)Error|MongooseError|buffering timed out|ECONNREFUSED|\bat .*\(.*:\d+:\d+\)/i.test(
      published,
    ) ||
    markers.some((marker) => marker && published.includes(marker))
  )
    failures.push('Mongo error content/stack/URI or fixture marker disclosed');
  if (login) {
    if (![500, 503].includes(value.status)) failures.push('expected login 500/503');
    if (value.body?.message !== safeMessage) failures.push('unsafe 5xx message');
    if (!requestIdPattern.test(value.body?.requestId || '') || value.body.requestId !== id)
      failures.push('missing or mismatched body requestId');
    if (value.body?.success !== false || value.body?.status !== value.status)
      failures.push('invalid 5xx envelope');
    if (
      Object.keys(value.body || {}).some(
        (key) => !['success', 'status', 'message', 'requestId'].includes(key),
      )
    )
      failures.push('unexpected 5xx disclosure field');
  }
  return failures;
}
module.exports = { inspectMongoResponse };
