const { createClient } = require('redis');
const logger = require('../utils/logger');
let client, subscriber, probeTimer, healthy = false;
const unavailable = () => Object.assign(new Error('Shared security store unavailable'), { statusCode: 503 });
async function bounded(command) {
  let timer;
  try {
    return await Promise.race([command, new Promise((_, reject) => {
      timer = setTimeout(() => { healthy = false; require('../controllers/notificationController').terminateAllStreams(); reject(unavailable()); }, 2500);
    })]);
  } finally { clearTimeout(timer); }
}
function namespace() { return process.env.REDIS_NAMESPACE || 'totmart:development'; }
function enabled() { return Boolean(process.env.REDIS_URL); }
function getClient() {
  if (!client?.isReady || !subscriber?.isReady || !healthy) throw unavailable();
  const connection = client;
  // The driver's queue timeout does not bound commands already written to a silent peer.
  return Object.fromEntries(['eval', 'del', 'publish', 'set', 'getDel'].map(method => [method, (...args) => bounded(connection[method](...args))]));
}
async function startRedis() {
  if (!enabled()) return;
  client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
    commandOptions: { timeout: 3000 }, commandsQueueMaxLength: 1000,
    socket: { connectTimeout: 5000, socketTimeout: 5000, reconnectStrategy: retries => Math.min(1000 + retries * 100, 5000) } });
  subscriber = client.duplicate();
  for (const connection of [client, subscriber]) {
    connection.on('error', () => logger.warn('Redis connection unavailable'));
    connection.on('reconnecting', () => require('../controllers/notificationController').terminateAllStreams());
  }
  let deadline;
  try {
    await Promise.race([
      (async () => { await client.connect(); await subscriber.connect(); })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Redis startup deadline exceeded')), 12000); }),
    ]);
  } catch (err) {
    await stopRedis();
    throw err;
  } finally { clearTimeout(deadline); }
  await subscriber.subscribe(namespace() + ':security', message => {
    try { const event = JSON.parse(message); if (typeof event.userId === 'string') require('../controllers/notificationController').terminateUserStreams(event.userId); }
    catch { logger.warn('Invalid security event ignored'); }
  });
  await subscriber.subscribe(namespace() + ':notifications', message => {
    try { require('../utils/notify').broadcastLocal(JSON.parse(message)); }
    catch { logger.warn('Invalid notification event ignored'); }
  });
  healthy = true;
  let probing = false;
  probeTimer = setInterval(async () => {
    if (probing) return;
    probing = true;
    try { await bounded(Promise.all([client.ping(), subscriber.ping()])); healthy = true; }
    catch { healthy = false; require('../controllers/notificationController').terminateAllStreams(); }
    finally { probing = false; }
  }, 1000);
  probeTimer.unref();
}
async function stopRedis() {
  clearInterval(probeTimer); healthy = false;
  for (const connection of [subscriber, client]) if (connection?.isOpen) connection.destroy();
  client = undefined; subscriber = undefined;
}
module.exports = { namespace, enabled, getClient, startRedis, stopRedis,
  ready: () => !enabled() || Boolean(healthy && client?.isReady && subscriber?.isReady) };
