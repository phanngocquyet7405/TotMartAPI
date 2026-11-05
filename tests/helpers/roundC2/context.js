const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(
  process.env.C2_DIRECTORY ||
    JSON.parse(fs.readFileSync('artifacts/round-c2/current.json')).directory,
);
if (
  path.dirname(root) !== path.resolve('artifacts/round-c2') ||
  !/^[a-f0-9-]{36}$/.test(path.basename(root)) ||
  !fs.existsSync(path.join(root, 'entry.json'))
)
  throw Error('C2 root capability mismatch');
const read = (file) => JSON.parse(fs.readFileSync(file));
const write = (name, data) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
function step(name) {
  const directory = path.resolve(fs.readFileSync(path.join(root, name + '-latest.txt'), 'utf8'));
  if (!directory.startsWith(root + path.sep + 'steps' + path.sep + name + path.sep))
    throw Error('C2 step path mismatch');
  return { directory, command: read(path.join(directory, 'command.json')) };
}
module.exports = { root, read, write, step };
