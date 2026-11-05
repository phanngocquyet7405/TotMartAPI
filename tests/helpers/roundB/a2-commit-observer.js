// Appended to the passive observer in the fixture preload, never installed in BE.
(function () {
  const mongoose = require('/app/node_modules/mongoose');
  const fs = require('node:fs');
  const { createHash } = require('node:crypto');
  const connect = mongoose.connect;
  mongoose.connect = async function (...args) {
    const result = await connect.apply(this, args);
    const client = mongoose.connection.getClient();
    const requests = new Map();
    const emit = (event, fields) =>
      fs.appendFileSync(
        '/fixture/a2-commits.jsonl',
        JSON.stringify({ event, at: Date.now(), ...fields }) + '\n',
      );
    client.on('commandStarted', (event) => {
      if (event.commandName !== 'commitTransaction') return;
      const transactionHash = createHash('sha256')
        .update(
          mongoose.mongo.BSON.serialize({
            lsid: event.command.lsid,
            txnNumber: event.command.txnNumber,
          }),
        )
        .digest('hex');
      requests.set(event.requestId, transactionHash);
      emit('commit_started', { wireId: event.requestId, transactionHash });
    });
    for (const name of ['commandSucceeded', 'commandFailed'])
      client.on(name, (event) => {
        if (event.commandName !== 'commitTransaction') return;
        const reply = event.reply || event.failure;
        emit(name, {
          wireId: event.requestId,
          transactionHash: requests.get(event.requestId),
          ok: reply?.ok,
          errorType: event.failure?.name,
          errorCode: reply?.code || reply?.writeConcernError?.code,
          errorLabels: reply?.errorLabels || [],
          durationMs: event.duration,
        });
      });
    return result;
  };
})();
