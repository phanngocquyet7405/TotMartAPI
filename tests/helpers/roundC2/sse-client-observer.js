const fs = require('node:fs');
const https = require('node:https');
const get = https.get;
const emit = (event, fields = {}) =>
  fs.appendFileSync(
    '/fixture/sse-legacy-events.jsonl',
    JSON.stringify({ at: Date.now(), event, ...fields }) + '\n',
  );
https.get = function (...args) {
  const req = get.apply(this, args);
  const destroy = req.destroy;
  req.destroy = function (...values) {
    emit('local_destroy');
    return destroy.apply(this, values);
  };
  req.on('error', (error) =>
    emit('request_error', { type: /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error' }),
  );
  req.on('response', (response) => {
    emit('response', { status: response.statusCode });
    response.on('data', (bytes) => emit('data', { bytes: bytes.length }));
    for (const name of ['end', 'close', 'aborted'])
      response.on(name, () => emit(name, { complete: response.complete }));
    response.on('error', () => emit('response_error'));
  });
  return req;
};
