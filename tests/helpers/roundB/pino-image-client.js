const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const pino = require('pino');
const logger = require('/app/src/utils/logger');
const logs = [];
// Capture only the real logger destination, preserving Pino and pino-http serializers.
logger[pino.symbols.streamSym] = { write: (line) => logs.push(JSON.parse(line)) };
const app = require('/app/src/app');
const { inspectPublishedLogs } = require('/fixture/disclosure-guard');
const marker = 'SYNTHETIC_DISCLOSURE_' + randomUUID();
const result = { mode: process.env.NODE_ENV, cases: [] };
let server;
async function main() {
  let fault;
  app.use('/_fixture/log', (req, res, next) => next(fault));
  // The sole test route must enter the real middleware chain before 404/errorHandler.
  const stack = app.router.stack;
  const layer = stack.pop();
  stack.splice(stack.length - 2, 0, layer);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  for (const field of ['message', 'stack', 'cause', 'provider', 'name', 'code']) {
    fault = Object.assign(new Error('Private fixture failure'), {
      dependency: 'MongoDB',
      code: 'ECONNRESET',
    });
    if (field === 'provider')
      fault.response = {
        data: { error: marker },
        config: { url: `mongodb://fixture:${marker}@mongo/fixture` },
      };
    else if (field === 'cause') fault.cause = new Error(marker);
    else fault[field] = marker;
    const offset = logs.length;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/_fixture/log`);
    const body = await response.json();
    await new Promise((resolve) => setImmediate(resolve));
    const emitted = logs.slice(offset);
    const automatic = emitted.find((entry) => entry.msg === 'request errored');
    const requestId = response.headers.get('x-request-id');
    const published = JSON.stringify({ body, logs: emitted });
    const evidence = {
      field,
      status: response.status,
      requestId,
      errorHandlerLog: emitted.some(
        (entry) => entry.event === 'request_failed' && entry.requestId === requestId,
      ),
      pinoHttpLog: !!automatic,
      automaticKeys: Object.keys(automatic?.err || {}),
      markerAbsent: !published.includes(marker),
      stackAbsent: !emitted.some((entry) => entry.err && 'stack' in entry.err),
      uriAbsent: !/mongodb(?:\+srv)?:\/\//.test(published),
      automaticRequestIdMatches: automatic?.req?.id === requestId,
      logGuardFailures: inspectPublishedLogs(emitted, {
        markers: [marker],
        requestIds: [requestId],
      }),
    };
    result.cases.push(evidence);
    assert.equal(response.status, 500);
    assert.equal(body.requestId, requestId);
    assert.equal(body.message, 'Lỗi hệ thống. Vui lòng thử lại.');
    assert(evidence.errorHandlerLog && evidence.pinoHttpLog && evidence.automaticRequestIdMatches);
    assert(evidence.markerAbsent && evidence.stackAbsent && evidence.uriAbsent);
    assert.deepEqual(evidence.logGuardFailures, []);
    assert(Object.keys(automatic.err).every((key) => ['type', 'code'].includes(key)));
  }
  result.passed = true;
}
main()
  .catch((error) => {
    result.passed = false;
    result.errorType = error.name;
  })
  .finally(async () => {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    console.log('PINO_IMAGE_RESULT=' + JSON.stringify(result));
  });
