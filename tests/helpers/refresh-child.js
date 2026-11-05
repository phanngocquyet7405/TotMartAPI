// Isolated recovery worker. Credentials arrive only over stdin, never argv/logs.
require('dotenv').config = () => ({});
const mongoose = require('mongoose');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { input += data; });
process.stdin.on('end', async () => {
  try {
    const { uri, refresh } = JSON.parse(input);
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error('Nonlocal target');
    await mongoose.connect(uri);
    const service = require('../../src/services/sessionService');
    const result = await service.rotate(refresh);
    process.stdout.write(JSON.stringify({ accepted: Boolean(result), digest: result && service.hash(result.refresh) }));
  } catch {
    process.stderr.write('Isolated refresh worker failed');
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
});
