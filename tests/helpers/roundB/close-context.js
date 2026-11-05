const fs = require('node:fs');
const path = require('node:path');
function directory() {
  if (process.env.ROUND_C2_DIR) {
    const value = path.resolve(process.env.ROUND_C2_DIR),
      base = path.resolve('artifacts/round-c2') + path.sep;
    if (
      !value.startsWith(base) ||
      !/^[a-f0-9-]{36}$/.test(path.basename(value)) ||
      !fs.existsSync(path.join(value, 'entry.json')) ||
      JSON.parse(fs.readFileSync(path.join(value, 'entry.json'))).round !== 'C2'
    )
      throw Error('Invalid C2 evidence capability');
    return value;
  }
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
