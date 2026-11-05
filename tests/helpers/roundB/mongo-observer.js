// Diagnostic preload only; never copies query filters, payloads, credentials or error text.
const fs = require('node:fs');
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const mongoose = require('/app/node_modules/mongoose');
const context = new AsyncLocalStorage();
// Observe controller entry without changing module load order or invoking providers.
const Module = require('node:module');
const loadModule = Module._load;
const wrapped = new WeakSet();
Module._load = function (name, ...args) {
  const value = loadModule.call(this, name, ...args);
  if (
    /controllers\/(checkOutController|authController|customerOrderController|operationsController|notificationController|productController)$/.test(
      name,
    ) &&
    !wrapped.has(value)
  ) {
    wrapped.add(value);
    for (const method of new Set([
      ...Object.keys(value),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(value) || {}),
    ])) {
      if (method === 'constructor' || typeof value[method] !== 'function') continue;
      const original = value[method];
      value[method] = function (req, ...rest) {
        if (req?.headers?.['x-fixture-trace'])
          emit('controller_enter', { controller: name.split('/').at(-1), handler: method });
        return original.call(this, req, ...rest);
      };
    }
  }
  return value;
};
let sequence = 0;
function emit(event, fields = {}) {
  const req = context.getStore();
  fs.appendFileSync(
    '/fixture/mongo-observer.jsonl',
    JSON.stringify({
      at: Date.now(),
      event,
      trace: req?.headers['x-fixture-trace'],
      requestId: req?.id,
      path: req?.url?.split('?')[0],
      method: req?.method,
      ...fields,
    }) + '\n',
  );
}
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event !== 'request') return originalEmit.call(this, event, ...args);
  const [req, res] = args;
  const observerHttpId = ++sequence;
  return context.run(req, () => {
    emit('http_start', { observerHttpId });
    res.once('finish', () =>
      emit('http_finish', {
        status: res.statusCode,
        headersSent: res.headersSent,
        requestId: req.id,
        observerHttpId,
      }),
    );
    res.once('close', () =>
      emit('http_close', {
        status: res.headersSent ? res.statusCode : null,
        headersSent: res.headersSent,
        finished: res.writableFinished,
        requestId: req.id,
        observerHttpId,
      }),
    );
    return originalEmit.call(this, event, ...args);
  });
};
const exec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = function (...args) {
  const queryId = ++sequence;
  const options = this.getOptions();
  const frame = new Error().stack.split('\n').find((line) => /\/app\/src\//.test(line));
  const location = frame?.match(/(\/app\/src\/[\w/.-]+\.js):(\d+):(\d+)/);
  emit('query_start', {
    queryId,
    model: this.model.modelName,
    operation: this.op,
    timeoutMS: options.timeoutMS ?? null,
    maxTimeMS: options.maxTimeMS ?? null,
    transaction: !!options.session?.inTransaction(),
    source: location ? { file: location[1], line: Number(location[2]) } : undefined,
  });
  const started = Date.now();
  return exec.apply(this, args).then(
    (value) => {
      emit('query_end', { queryId, durationMs: Date.now() - started, outcome: 'success' });
      return value;
    },
    (error) => {
      emit('query_end', {
        queryId,
        durationMs: Date.now() - started,
        outcome: 'error',
        errorType: /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error',
      });
      throw error;
    },
  );
};
const connect = mongoose.connect;
mongoose.connect = async function (uri, options) {
  // monitorCommands is observability only; preserve every runtime timeout and pool option.
  const result = await connect.call(this, uri, { ...options, monitorCommands: true });
  const client = mongoose.connection.getClient();
  emit(
    'driver_options',
    Object.fromEntries(
      [
        'serverSelectionTimeoutMS',
        'socketTimeoutMS',
        'connectTimeoutMS',
        'waitQueueTimeoutMS',
        'maxPoolSize',
        'retryReads',
        'retryWrites',
        'timeoutMS',
      ].map((key) => [key, client.options[key] ?? null]),
    ),
  );
  client.on('commandStarted', (event) =>
    emit('command_start', {
      wireId: event.requestId,
      command: event.commandName,
      collection:
        typeof event.command[event.commandName] === 'string'
          ? event.command[event.commandName]
          : undefined,
      transaction: event.command.autocommit === false,
      maxTimeMS: event.command.maxTimeMS ?? null,
    }),
  );
  for (const event of ['commandSucceeded', 'commandFailed'])
    client.on(event, (value) =>
      emit(event, {
        wireId: value.requestId,
        command: value.commandName,
        durationMs: value.duration,
      }),
    );
  for (const event of [
    'connectionCheckOutStarted',
    'connectionCheckedOut',
    'connectionCheckOutFailed',
    'connectionCheckedIn',
    'connectionClosed',
    'connectionPoolCleared',
    'serverHeartbeatFailed',
  ])
    client.on(event, () => emit(event));
  return result;
};
