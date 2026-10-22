const fs = require('node:fs');
const path = require('node:path');
function directory() {
  if (!process.env.ROUND_B_CLOSE_DIR) return null;
  const value = path.resolve(process.env.ROUND_B_CLOSE_DIR);
  const base = path.resolve('artifacts/round-b/close') + path.sep;
  if (
    !value.startsWith(base) ||
    !/^[a-f0-9-]{36}$/.test(path.basename(value)) ||
    !fs.existsSync(path.join(value, 'entry.json'))
  )
    throw Error('Invalid close evidence capability');
  return value;
}
function evidence(file) {
  return path.join(directory() || 'artifacts/round-b', file);
}
module.exports = { directory, evidence };
