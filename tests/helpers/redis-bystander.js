const { createClient } = require('redis');
const { localRedisUrl } = require('./localRedisUrl');

async function withRedisBystander(url, outageUrl, work, makeClient = createClient) {
  if (!url)
    throw new Error('BLOCKED: missing B01 Redis fixture; run npm run test:b01 or npm run test:b07');
  const bystander = localRedisUrl(url),
    outage = localRedisUrl(outageUrl);
  if (bystander.port === outage.port) throw new Error('Redis bystander must be a separate fixture');
  const client = makeClient({ url, socket: { connectTimeout: 2000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await client.connect();
    return await work(client);
  } finally {
    if (client.isOpen) client.destroy();
  }
}

module.exports = { withRedisBystander };
