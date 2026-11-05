const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { A } = require('/fixture/client');
// Private synthetic fixture remains inside the disposable client; never exported.
const saved = JSON.parse(fs.readFileSync('/fixture/private-fault.json'));
const state = { pid: process.pid, startedAt: Date.now(), streams: {} };
const handles = [];
const save = () =>
  fs.writeFileSync('/fixture/sse-independent.json', JSON.stringify({ ...state, at: Date.now() }));
const emit = (label, event, fields = {}) => {
  fs.appendFileSync(
    '/fixture/sse-independent-events.jsonl',
    JSON.stringify({ at: Date.now(), label, event, ...fields }) + '\n',
  );
  save();
};
async function open(label) {
  const ticket = await A.http(1, '/api/admin/notifications/stream-ticket', 'GET', undefined, {
    Authorization: 'Bearer ' + saved.jwt,
  });
  A.assert.equal(ticket.status, 200);
  const path =
    '/api/admin/notifications/stream?ticket=' + encodeURIComponent(ticket.body.data.ticket);
  const row = (state.streams[label] = { closed: false, bytes: 0 });
  await new Promise((resolve, reject) => {
    const req =
      label === 'direct'
        ? http.get({
            hostname: 'staging',
            port: 3001,
            path,
            headers: { Origin: 'https://app.totmart.test', 'x-fixture-sse-observer': label },
          })
        : https.get(A.url(1) + path, {
            headers: { Origin: 'https://app.totmart.test', 'x-fixture-sse-observer': label },
          });
    handles.push(req);
    const timer = setTimeout(() => {
      row.localDestroyAt = Date.now();
      req.destroy();
      reject(Error('Observer open deadline'));
    }, 8000);
    req.on('error', () => {
      emit(label, 'request_error');
      reject(Error('Observer request error'));
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      row.status = res.statusCode;
      row.openedAt = Date.now();
      emit(label, 'response', { status: res.statusCode });
      if (res.statusCode !== 200) {
        res.resume();
        reject(Error('Observer rejected'));
        return;
      }
      res.on('data', (data) => {
        row.bytes += data.length;
        row.lastDataAt = Date.now();
        emit(label, 'data', { bytes: data.length });
      });
      for (const name of ['end', 'close', 'aborted'])
        res.on(name, () => {
          row.closed = true;
          row[name + 'At'] = Date.now();
          emit(label, name, { complete: res.complete });
        });
      res.on('error', () => {
        row.responseErrorAt = Date.now();
        emit(label, 'response_error');
      });
      resolve();
    });
  });
}
async function main() {
  await open('independent-proxy');
  await open('direct');
  state.ready = true;
  save();
  const start = Date.now();
  while (!fs.existsSync('/fixture/sse-observer-stop.json') && Date.now() - start < 180000) {
    await new Promise((r) => setTimeout(r, 500));
    save();
  }
  state.localCleanupAt = Date.now();
  emit(null, 'observer_cleanup');
  for (const req of handles) req.destroy();
  save();
}
main().catch((error) => {
  state.failureType = error.name;
  save();
  for (const req of handles) req.destroy();
  process.exitCode = 1;
});
