// Disposable OP_MSG wire proxy. Never publishes command bodies, credentials or URIs.
// Forward the real commit unchanged; retain its successful Mongo reply until the
// independent observer proves the obligation, then destroy this socket without ACK.
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { BSON } = require('/app/node_modules/mongoose').mongo;
let armed = false,
  held,
  sequence = 0;
const events = [];
function emit(event, fields = {}) {
  events.push({ event, at: Date.now(), ...fields });
  fs.writeFileSync('/fixture/ack-evidence.json', JSON.stringify(events));
}
function frames(socket, consume) {
  let buffer = Buffer.alloc(0);
  socket.on('data', (bytes) => {
    buffer = Buffer.concat([buffer, bytes]);
    while (buffer.length >= 4) {
      const length = buffer.readInt32LE(0);
      if (length < 16 || length > 64 * 1024 * 1024) {
        socket.destroy();
        emit('invalid_frame');
        return;
      }
      if (buffer.length < length) return;
      const frame = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      consume(frame);
    }
  });
}
function body(frame) {
  if (frame.readInt32LE(12) !== 2013 || frame[20] !== 0) return null;
  const size = frame.readInt32LE(21);
  return BSON.deserialize(frame.subarray(21, 21 + size), { promoteLongs: false });
}
net
  .createServer((downstream) => {
    const connection = ++sequence,
      upstream = net.connect(27017, 'mongo');
    const targets = new Map();
    frames(downstream, (frame) => {
      const command = body(frame);
      if (armed && command?.commitTransaction === 1) {
        armed = false;
        const row = {
          connection,
          requestId: frame.readInt32LE(4),
          transactionHash: createHash('sha256')
            .update(BSON.serialize({ lsid: command.lsid, txnNumber: command.txnNumber }))
            .digest('hex'),
        };
        targets.set(row.requestId, row);
        emit('commit_forwarded', row);
      }
      upstream.write(frame);
    });
    frames(upstream, (frame) => {
      const target = targets.get(frame.readInt32LE(8));
      if (target) {
        const reply = body(frame);
        held = { downstream, upstream, target, frame };
        emit('commit_reply_held', {
          ...target,
          responseTo: frame.readInt32LE(8),
          ok: reply?.ok,
          writeConcernError: !!reply?.writeConcernError,
          writeConcernCode: reply?.writeConcernError?.code,
          errorLabels: reply?.errorLabels,
          bytes: frame.length,
        });
        // No byte of this response is forwarded; other connections continue.
        return;
      }
      downstream.write(frame);
    });
    downstream.on('error', () => {});
    upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
  })
  .listen(27017, '0.0.0.0');
http
  .createServer((req, res) => {
    if (req.url === '/arm' && req.method === 'POST' && !armed && !held) {
      armed = true;
      emit('armed');
    } else if (req.url === '/drop' && req.method === 'POST' && held) {
      emit('ack_dropped', held.target);
      held.downstream.destroy();
      held.upstream.destroy();
      held = undefined;
    } else if (req.url === '/release' && req.method === 'POST' && held) {
      emit('server_reply_released', held.target);
      held.downstream.write(held.frame);
      held = undefined;
    } else if (req.url !== '/status') {
      res.writeHead(409);
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ready: true, armed, holding: !!held, events }));
  })
  .listen(28080, '0.0.0.0');
