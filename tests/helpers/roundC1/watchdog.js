// Independent fixture process, not production alert wiring.
const fs = require('node:fs');
const path = require('node:path');
const { root, run } = require('./context');
const { httpDelivery } = require('../../../scripts/dispatch-operations-alerts');
const attempt = process.env.C1_ATTEMPT;
if (!/^[a-z0-9-]+$/.test(attempt || '')) throw new Error('C1 watchdog attempt mismatch');
const target = new URL(process.env.C1_WATCHDOG_SINK);
if (
  target.hostname !== '127.0.0.1' ||
  target.username ||
  target.password ||
  target.protocol !== 'http:' ||
  !target.port
)
  throw new Error('C1 watchdog requires owned loopback sink');
const heartbeat = path.join(root, 'alert-heartbeat-' + attempt + '.json'),
  file = path.join(root, 'watchdog-state-' + attempt + '.json');
const state = {
  run,
  attempt,
  pid: process.pid,
  thresholdMs: 750,
  generation: 0,
  status: 'unknown',
  pending: null,
};
const save = () => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(file + '.tmp', file);
};
const deliver = httpDelivery(target.href);
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    let observed;
    try {
      observed = JSON.parse(fs.readFileSync(heartbeat));
    } catch {
      observed = null;
    }
    const last = observed?.run === run ? observed.lastSummaryAt : 0;
    state.lastSummaryAt = last;
    const desired = Date.now() - last > state.thresholdMs ? 'firing' : 'recovery';
    if (state.status === 'unknown' && desired === 'recovery') {
      state.status = 'recovery';
      save();
      return;
    }
    if (!state.pending && state.status === desired) return;
    if (!state.pending) {
      state.generation++;
      state.pending = {
        key: `c1-deadman-${run}-${state.generation}`,
        payload: {
          queue: 'deadMan',
          status: desired,
          count: desired === 'firing' ? 1 : 0,
          observedAt: new Date().toISOString(),
        },
      };
      save();
    }
    try {
      await deliver(state.pending.payload, state.pending.key);
      state.status = state.pending.payload.status;
      state.pending = null;
      state.deliveryFailed = false;
    } catch {
      state.deliveryFailed = true;
    }
    save();
  } finally {
    busy = false;
  }
}
const timer = setInterval(() => tick().catch(() => process.exit(1)), 100);
tick()
  .then(() => process.send?.({ ready: true }))
  .catch(() => process.exit(1));
process.on('message', (message) => {
  if (message.stop) {
    clearInterval(timer);
    process.exit(busy ? 1 : 0);
  }
});
