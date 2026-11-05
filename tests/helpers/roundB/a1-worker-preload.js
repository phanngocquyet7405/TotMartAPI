// Fixture-only control channel over tmpfs, never an HTTP route or shipped image.
// Execute real server.js/configuration and real drains; trigger timers explicitly
// to establish deterministic barriers without changing runtime DB timeouts.
const fs = require('node:fs');
const Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  const value = load.call(this, name, ...args);
  if (
    /jobs\/(deliveryScheduler|orderExpiryScheduler|paymentReconciliationScheduler|notificationOutboxScheduler|securityOutboxScheduler)$/.test(
      name,
    )
  )
    for (const key of ['start', 'startDeliveryScheduler', 'startOrderExpiryScheduler'])
      if (typeof value[key] === 'function') value[key] = () => ({ stop() {} });
  return value;
};
const publish = (name, value) =>
  fs.writeFileSync('/fixture/' + name + '.json', JSON.stringify({ at: Date.now(), ...value }));
const jobs = {
  expiry: () => require('/app/src/jobs/orderExpiryScheduler').expireStaleOrders(),
  delivery: () => require('/app/src/jobs/deliveryScheduler').processDeliveries(),
  payment: () => require('/app/src/jobs/paymentReconciliationScheduler').drain(),
  notification: () => require('/app/src/jobs/notificationOutboxScheduler').drain(),
  security: () => require('/app/src/jobs/securityOutboxScheduler').drain(),
};
async function command(message) {
  const { id, action, worker } = message;
  try {
    if (action === 'drain') await jobs[worker]();
    else if (action === 'fail-payment-once') {
      const model = require('/app/src/models/PaymentAllocation'),
        original = model.create;
      model.create = async function () {
        model.create = original;
        publish('event-payment-failed', {});
        throw Object.assign(new Error('Fixture allocation interruption'), { statusCode: 503 });
      };
    } else if (action === 'fail-expiry-once') {
      const prototype = require('/app/src/models/Order').prototype,
        original = prototype.save;
      prototype.save = async function (...args) {
        prototype.save = original;
        await original.apply(this, args);
        publish('event-expiry-failed', {});
        throw new Error('Fixture expiry transaction interruption');
      };
    } else if (action === 'fail-delivery-once') {
      const model = require('/app/src/models/SubscriptionFulfillment'),
        original = model.updateOne;
      model.updateOne = async function (...args) {
        model.updateOne = original;
        await original.apply(this, args);
        publish('event-delivery-failed', {});
        throw new Error('Fixture post-upsert interruption');
      };
    } else if (action === 'hold-notification-claim') {
      const model = require('/app/src/models/NotificationOutbox'),
        original = model.findOneAndUpdate;
      model.findOneAndUpdate = async function (...args) {
        const event = await original.apply(this, args);
        if (event) {
          model.findOneAndUpdate = original;
          publish('event-notification-held', {
            recordId: String(event._id),
            leaseUntil: event.leaseUntil.getTime(),
          });
          await new Promise(() => {});
        }
        return event;
      };
    } else if (action === 'hold-security-after-publish' || action === 'fail-notification-once') {
      const redis = require('/app/src/config/redis'),
        original = redis.getClient;
      redis.getClient = () => {
        const client = original();
        return {
          ...client,
          publish: async (...args) => {
            redis.getClient = original;
            if (action === 'fail-notification-once') {
              publish('event-notification-failed', {});
              throw new Error('Fixture transport interruption');
            }
            const result = await client.publish(...args);
            publish('event-security-held', { recordId: JSON.parse(args[1]).eventId });
            await new Promise(() => {});
            return result;
          },
        };
      };
    } else throw Error('Unsupported fixture command');
    publish('result-' + id, { ok: true });
  } catch (error) {
    publish('result-' + id, { ok: false, errorType: error.name });
  }
}
const received = new Set();
const timer = setInterval(() => {
  for (const name of fs
    .readdirSync('/fixture')
    .filter((n) => /^command-[a-f0-9-]{36}\.json$/.test(n))) {
    if (received.has(name)) continue;
    const message = JSON.parse(fs.readFileSync('/fixture/' + name));
    // Retain immutable bytes for the host's post-transfer digest verification.
    received.add(name);
    void command(message);
  }
}, 50);
timer.unref();
