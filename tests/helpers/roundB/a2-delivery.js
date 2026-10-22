// Read-only final evidence checks. No cleanup capability, deployment or seal.
const fs = require('node:fs');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const root = JSON.parse(fs.readFileSync('artifacts/round-b/a2-0/current.json')).directory;
const entry = JSON.parse(fs.readFileSync(root + '/entry.json'));
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const lines = (text) => text.trim().split(/\r?\n/).filter(Boolean);
async function main() {
  const containers = lines(docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']));
  const networks = new Set(lines(docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}'])));
  const images = new Set(
    lines(docker(['image', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}'])),
  );
  const liveIds = new Set(containers.map((line) => line.split(' ')[0]));
  const manifests = fs
    .readdirSync('artifacts/round-b')
    .filter((file) => file.startsWith('a2-') && file.endsWith('-resources.json'));
  const resources = manifests.flatMap((file) => {
    const data = JSON.parse(fs.readFileSync('artifacts/round-b/' + file));
    return data.resources.map((resource) => ({
      file,
      id: resource.id,
      type: resource.type,
      owned: resource.owner === data.run && resource.name.startsWith('totmart-b-' + data.run),
      absent: !(resource.type === 'container' ? liveIds : networks).has(resource.id),
    }));
  });
  const before = Object.fromEntries(
    Object.entries(entry.source).filter(([file]) => file.startsWith('src/')),
  );
  const current = sourceManifest();
  const checks = {
    sourceBEUnchanged:
      Object.entries(before).every(([file, hash]) => current[file] === hash) &&
      Object.keys(current).filter((file) => file.startsWith('src/')).length ===
        Object.keys(before).length,
    protectedFilesUnchanged: Object.entries(entry.protectedHashes).every(
      ([file, hash]) => sha256(fs.readFileSync(file)) === hash,
    ),
    originalContainersPresent: lines(entry.containers).every((line) => containers.includes(line)),
    originalImagesPresent: lines(entry.images).every((line) => images.has(line)),
    allSessionDockerResourcesAbsent:
      resources.length > 0 && resources.every((resource) => resource.owned && resource.absent),
  };
  const indexFiles = fs
    .readdirSync(root, { recursive: true })
    .filter((file) => /identity-migration-[a-f0-9-]+\.json$/.test(file));
  const fullDirectories = ['artifacts/b01/all-zkFl0r', 'artifacts/b01/all-qQbF34'];
  const indexes = [
    ...indexFiles.map((file) => root + '/' + file),
    ...fullDirectories.flatMap((directory) =>
      fs
        .readdirSync(directory)
        .filter((file) => file.startsWith('identity-migration-'))
        .map((file) => directory + '/' + file),
    ),
  ].map((file) => ({ file, ...JSON.parse(fs.readFileSync(file)) }));
  const ports = [...new Set(indexes.flatMap((index) => index.hosts.map((host) => host.port)))];
  const closed = await Promise.all(
    ports.map(
      (port) =>
        new Promise((resolve) => {
          const socket = net.createConnection({ host: '127.0.0.1', port });
          socket.setTimeout(1000);
          socket.on('connect', () => {
            socket.destroy();
            resolve({ port, closed: false });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ port, closed: false, timeout: true });
          });
          socket.on('error', (error) =>
            resolve({ port, closed: error.code === 'ECONNREFUSED', code: error.code }),
          );
        }),
    ),
  );
  checks.exactIndexDropsVerifiedAbsent = indexes
    .flatMap((index) => index.drops)
    .every(
      (drop) =>
        ['legacy_custom_display', 'custom_display_desc'].includes(drop.name) &&
        drop.absent &&
        drop.sameClient &&
        drop.instanceVerified &&
        drop.databaseVerified &&
        drop.collectionVerified &&
        drop.markerVerified,
    );
  checks.identityMongoPortsClosed = closed.length > 0 && closed.every((port) => port.closed);
  const report = {
    checks,
    resources,
    indexEvidenceFiles: indexes.map((index) => index.file),
    ports: closed,
    fullRuns: fullDirectories.map((directory) => ({
      directory,
      ...JSON.parse(fs.readFileSync(directory + '/exit.json')),
    })),
    originalContainerCount: lines(entry.containers).length,
    productionReadiness: 'not claimed',
    roundCAuthorized: false,
    a21AndA22: 'NOT-RUN; owner review required',
  };
  report.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
  fs.writeFileSync(root + '/delivery.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      checks,
      resources: resources.length,
      identityMongoPorts: ports.length,
      exitCode: report.exitCode,
    }),
  );
  process.exitCode = report.exitCode;
}
main().catch(() => {
  console.error('Read-only A2 evidence verification failed');
  process.exitCode = 1;
});
