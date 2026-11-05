const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function certificates(directory, lease) {
  const openssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
  const run = (args) =>
    execFileSync(openssl, args, {
      cwd: directory,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
  for (const ca of ['ca', 'wrong-ca'])
    run([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${ca}.key`,
      '-out',
      `${ca}.pem`,
      '-days',
      '2',
      '-subj',
      `/CN=TotMart-${lease.run}-${ca}`,
    ]);
  for (const [name, hosts] of [
    ['redis', ['redis.totmart.test']],
    ['proxy', ['api-prod.totmart.test', 'api-stage.totmart.test']],
  ]) {
    fs.writeFileSync(
      path.join(directory, `${name}.ext`),
      `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}\nextendedKeyUsage=serverAuth\n`,
    );
    run([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=${hosts[0]}`,
    ]);
    run([
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${name}.pem`,
      '-days',
      '2',
      '-extfile',
      `${name}.ext`,
    ]);
  }
  return Object.fromEntries(
    ['ca.pem', 'wrong-ca.pem', 'redis.key', 'redis.pem', 'proxy.key', 'proxy.pem'].map((name) => [
      name,
      fs.readFileSync(path.join(directory, name), 'utf8'),
    ]),
  );
}
module.exports = certificates;
