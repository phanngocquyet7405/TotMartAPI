// Test-only observation: no payload, query filter, header, ticket or credential is recorded.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
if (process.env.FIXTURE_SSE_SOURCE_SHA256) {
  const crypto = require('node:crypto');
  const bytes = fs.readFileSync('/fixture/notification-controller.js');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (
    !/^[a-f0-9-]{36}$/.test(process.env.FIXTURE_RUN || '') ||
    hash !== process.env.FIXTURE_SSE_SOURCE_SHA256
  )
    throw Error('Source overlay capability mismatch');
  fs.writeFileSync('/app/src/controllers/notificationController.js', bytes);
  fs.writeFileSync(
    '/fixture/source-overlay.json',
    JSON.stringify({
      run: process.env.FIXTURE_RUN,
      file: 'src/controllers/notificationController.js',
      sha256: hash,
      bytes: bytes.length,
      baseImageUnchanged: true,
    }),
  );
}
const streams = [];
let sequence = 0;
function emit(event, fields = {}) {
  const state = context.getStore();
  fs.appendFileSync(
    '/fixture/sse-server-events.jsonl',
    JSON.stringify({ at: Date.now(), event, stream: state?.id, label: state?.label, ...fields }) +
      '\n',
  );
}
function type(error) {
  return /^[A-Za-z]+Error$/.test(error?.name) ? error.name : 'Error';
}
for (const proto of [http.Server.prototype, https.Server.prototype]) {
  const original = proto.emit;
  proto.emit = function (event, ...args) {
    if (event !== 'request' || args[0].url.split('?')[0] !== '/api/admin/notifications/stream')
      return original.call(this, event, ...args);
    const [req, res] = args;
    const value = req.headers['x-fixture-sse-observer'];
    const state = {
      id: ++sequence,
      label: ['direct', 'independent-proxy'].includes(value) ? value : 'legacy',
      openedAt: Date.now(),
      response: res,
      socket: req.socket,
      pending: new Set(),
    };
    streams.push(state);
    return context.run(state, () => {
      emit('request');
      for (const name of ['write', 'end', 'destroy']) {
        const method = res[name];
        res[name] = function (...values) {
          context.run(state, () =>
            emit('response_' + name, {
              writableEnded: res.writableEnded,
              destroyed: res.destroyed,
            }),
          );
          return method.apply(this, values);
        };
      }
      for (const name of ['finish', 'close', 'error'])
        res.on(name, (error) =>
          context.run(state, () =>
            emit('response_' + name, {
              writableEnded: res.writableEnded,
              destroyed: res.destroyed,
              ...(name === 'error' ? { errorType: type(error) } : {}),
            }),
          ),
        );
      req.socket.once('close', () => context.run(state, () => emit('socket_close')));
      return original.call(this, event, ...args);
    });
  };
}
const request = http.request;
http.request = function (...args) {
  const result = request.apply(this, args);
  if (args[0]?.path?.split('?')[0] === '/api/admin/notifications/stream') {
    const state = context.getStore();
    result.on('response', (response) => {
      const observe = (event) =>
        context.run(state, () =>
          emit('upstream_' + event, { complete: response.complete, destroyed: response.destroyed }),
        );
      context.run(state, () => emit('upstream_response', { status: response.statusCode }));
      for (const name of ['end', 'close', 'aborted']) response.on(name, () => observe(name));
      response.on('error', (error) =>
        context.run(state, () => emit('upstream_error', { errorType: type(error) })),
      );
    });
  }
  return result;
};
const interval = global.setInterval;
const heartbeatTimers = new Map();
global.setInterval = function (callback, ms, ...args) {
  const state = context.getStore();
  if (state && ms === 20000) {
    const observed = callback;
    callback = function (...values) {
      emit('heartbeat_enter');
      const result = observed.apply(this, values);
      return Promise.resolve(result).then(
        (value) => {
          emit('heartbeat_return');
          return value;
        },
        (error) => {
          emit('heartbeat_throw', { errorType: type(error) });
          throw error;
        },
      );
    };
  }
  const handle = interval(callback, ms, ...args);
  if (state && ms === 20000) heartbeatTimers.set(handle, state);
  return handle;
};
const clear = global.clearInterval;
global.clearInterval = function (handle) {
  const state = heartbeatTimers.get(handle);
  if (state) {
    context.run(state, () => emit('heartbeat_clear'));
    heartbeatTimers.delete(handle);
  }
  return clear(handle);
};
const mongoose = require('/app/node_modules/mongoose');
const exec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = function (...args) {
  const state = context.getStore();
  if (!state) return exec.apply(this, args);
  const query = ++sequence;
  state.pending.add(query);
  emit('query_start', {
    query,
    model: this.model.modelName,
    operation: this.op,
    timeoutMS: this.getOptions().timeoutMS ?? null,
  });
  return exec.apply(this, args).then(
    (value) => {
      state.pending.delete(query);
      emit('query_end', { query, outcome: 'success' });
      return value;
    },
    (error) => {
      state.pending.delete(query);
      emit('query_end', { query, outcome: 'error', errorType: type(error) });
      throw error;
    },
  );
};
mongoose.connection.once('open', () => {
  const client = mongoose.connection.getClient();
  emit(
    'driver_options',
    Object.fromEntries(
      ['serverSelectionTimeoutMS', 'socketTimeoutMS', 'connectTimeoutMS', 'timeoutMS'].map(
        (name) => [name, client.options[name] ?? null],
      ),
    ),
  );
  for (const event of ['serverHeartbeatFailed', 'connectionPoolCleared', 'connectionClosed'])
    client.on(event, () => emit(event));
});
interval(() => {
  const state = {
    at: Date.now(),
    streams: streams.map((s) => ({
      id: s.id,
      label: s.label,
      openedAt: s.openedAt,
      writableEnded: s.response.writableEnded,
      destroyed: s.response.destroyed,
      socketDestroyed: s.socket.destroyed,
      pendingQueries: [...s.pending],
    })),
  };
  fs.writeFileSync('/fixture/sse-server-state.json', JSON.stringify(state));
  fs.appendFileSync('/fixture/sse-server-snapshots.jsonl', JSON.stringify(state) + '\n');
}, 1000).unref();
