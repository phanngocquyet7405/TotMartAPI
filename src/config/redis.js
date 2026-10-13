const { createClient } = require('redis');
const logger = require('../utils/logger');
let client, subscriber;
function namespace() { return process.env.REDIS_NAMESPACE || 'totmart:development'; }
function enabled() { return Boolean(process.env.REDIS_URL); }
function getClient() {
  if (!client?.isReady) throw Object.assign(new Error('Shared security store unavailable'), { statusCode: 503 });
  return client;
}
async function startRedis() {
  if (!enabled()) return;
  client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(1000 + retries * 100, 5000) } });
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
}
async function stopRedis() {
  for (const connection of [subscriber, client]) if (connection?.isOpen) connection.destroy();
  client = undefined; subscriber = undefined;
}
module.exports = { namespace, enabled, getClient, startRedis, stopRedis,
  ready: () => !enabled() || Boolean(client?.isReady && subscriber?.isReady) };
