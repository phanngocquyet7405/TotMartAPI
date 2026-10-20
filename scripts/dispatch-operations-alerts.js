// Explicit opt-in transport adapter. Importing never connects or reads .env.
const queues = new Set([
  'notificationOutbox',
  'securityOutbox',
  'overdueRefunds',
  'webhookRetries',
  'attemptGrowth',
  'attemptCapacity',
]);
function createDispatcher({
  readSummary,
  deliver,
  state = {},
  save = async () => {},
  now = Date.now,
  repeatMs = 60000,
}) {
  let busy = false;
  return {
    state,
    async tick() {
      if (busy) return { busy: true };
      busy = true;
      try {
        const summary = await readSummary();
        const active = new Map(
          (summary.alerts || [])
            .filter((a) => queues.has(a.queue) && Number.isSafeInteger(a.count) && a.count > 0)
            .map((a) => [a.queue, a.count]),
        );
        let sent = 0,
          failed = 0;
        for (const queue of new Set([
          ...active.keys(),
          ...Object.keys(state).filter((q) => queues.has(q)),
        ])) {
          const item = state[queue] || { generation: 0 };
          state[queue] = item;
          const status = active.has(queue) ? 'firing' : 'recovery',
            count = active.get(queue) || 0,
            time = now();
          if (!item.pending && item.status === status && time - (item.sentAt || 0) < repeatMs)
            continue;
          if (!item.pending && item.status === status && status === 'recovery') continue;
          if (!item.pending) {
            item.generation++;
            item.pending = {
              key: `${queue}:${item.generation}`,
              payload: { queue, status, count, observedAt: new Date(time).toISOString() },
            };
            await save(state);
          }
          try {
            await deliver(item.pending.payload, item.pending.key);
            item.status = item.pending.payload.status;
            item.sentAt = time;
            item.pending = null;
            item.deliveryFailed = false;
            sent++;
          } catch {
            item.deliveryFailed = true;
            failed++;
          }
          await save(state);
        }
        return { sent, failed, deliveryHealthy: failed === 0 };
      } finally {
        busy = false;
      }
    },
  };
}
function httpDelivery(url) {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    throw new Error('Invalid alert sink URL');
  return async (payload, key) => {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Alert transport rejected');
    await response.arrayBuffer();
  };
}
module.exports = { createDispatcher, httpDelivery };
