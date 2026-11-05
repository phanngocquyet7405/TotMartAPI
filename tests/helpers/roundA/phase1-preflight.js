const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const root = process.cwd();
const output = path.join(root, 'artifacts/round-a');
const run = randomUUID();
const name = `totmart-a-${run}-tools`;
const networkName = `totmart-a-${run}-preflight`;
const report = { run, commands: [], resources: [], cleanupExitCode: null };
const save = () =>
  fs.writeFileSync(
    path.join(output, 'phase1-preflight.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
function docker(args) {
  try {
    const value = execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    report.commands.push({ operation: args[0], exitCode: 0 });
    return value;
  } catch (error) {
    report.commands.push({
      operation: args[0],
      exitCode: typeof error.status === 'number' ? error.status : null,
    });
    throw new Error(`Docker ${args[0]} failed`, { cause: error });
  }
}
let networkId, containerId;
function verifyNetwork() {
  const value = JSON.parse(docker(['network', 'inspect', '--format', '{{json .}}', networkId]));
  if (
    value.Id !== networkId ||
    value.Name !== networkName ||
    value.Labels?.['totmart.test.run'] !== run ||
    !value.Internal
  )
    throw new Error('Network ownership mismatch');
}
function verifyContainer() {
  const value = JSON.parse(docker(['inspect', '--format', '{{json .}}', containerId]));
  if (
    value.Id !== containerId ||
    value.Name !== '/' + name ||
    value.Config?.Labels?.['totmart.test.run'] !== run ||
    value.HostConfig.NetworkMode !== networkName
  )
    throw new Error('Container ownership mismatch');
  if (value.Mounts.some((mount) => mount.Type !== 'tmpfs'))
    throw new Error('Unexpected persistent mount');
}
try {
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report.node = process.version;
  report.platform = process.platform;
  report.lockfileSha256 = sha256(fs.readFileSync('package-lock.json'));
  const manifest = sourceManifest();
  fs.writeFileSync(
    path.join(output, 'source-sha256.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  report.sourceCount = Object.keys(manifest).length;
  report.sourceManifestSha256 = sha256(fs.readFileSync(path.join(output, 'source-sha256.json')));
  report.dockerVersion = docker([
    'version',
    '--format',
    'Client={{.Client.Version}} Server={{.Server.Version}}',
  ]);
  report.dockerInfo = docker([
    'info',
    '--format',
    'OSType={{.OSType}} OperatingSystem={{.OperatingSystem}} KernelVersion={{.KernelVersion}} CPUs={{.NCPU}} MemoryBytes={{.MemTotal}}',
  ]);
  report.existingContainers = docker([
    'ps',
    '-a',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Names}}',
  ]).split('\n');
  report.existingImages = docker([
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}} {{.Repository}}:{{.Tag}}',
  ]).split('\n');
  report.fixtureImages = {};
  for (const image of ['mongo:7.0', 'redis:7.4-alpine']) {
    report.fixtureImages[image] = JSON.parse(
      docker([
        'image',
        'inspect',
        '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}}}',
        image,
      ]),
    );
  }
  networkId = docker([
    'network',
    'create',
    '--internal',
    '--label',
    `totmart.test.run=${run}`,
    networkName,
  ]);
  report.resources.push({
    type: 'network',
    id: networkId,
    name: networkName,
    owner: run,
    cleaned: false,
  });
  save();
  verifyNetwork();
  containerId = docker([
    'create',
    '--name',
    name,
    '--label',
    `totmart.test.run=${run}`,
    '--network',
    networkName,
    '--tmpfs',
    '/data/db',
    '--tmpfs',
    '/data/configdb',
    '--entrypoint',
    'sleep',
    report.fixtureImages['mongo:7.0'].id,
    '300',
  ]);
  report.resources.push({ type: 'container', id: containerId, name, owner: run, cleaned: false });
  save();
  verifyContainer();
  docker(['start', containerId]);
  verifyContainer();
  report.tools = {};
  for (const tool of ['mongodump', 'mongorestore']) {
    verifyContainer();
    const version = docker(['exec', containerId, tool, '--version']).split('\n')[0];
    if (!/^(mongodump|mongorestore) version: [0-9.]+$/.test(version))
      throw new Error('Unexpected tool version output');
    report.tools[tool] = version;
  }
  report.preflightExitCode = 0;
} catch (error) {
  report.preflightExitCode = 1;
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  report.cleanupExitCode = 0;
  try {
    if (containerId) {
      verifyContainer();
      docker(['rm', '-f', containerId]);
      report.resources.find((resource) => resource.id === containerId).cleaned = true;
    }
    if (networkId) {
      verifyNetwork();
      docker(['network', 'rm', networkId]);
      report.resources.find((resource) => resource.id === networkId).cleaned = true;
    }
    const containers = new Set(
      docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    const networks = new Set(
      docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n'),
    );
    for (const resource of report.resources) {
      resource.absent = !(resource.type === 'container' ? containers : networks).has(resource.id);
      if (!resource.absent) {
        report.cleanupExitCode = 1;
        report.cleanupFailure = 'Owned resource remains after cleanup';
        process.exitCode = 1;
      }
    }
  } catch (error) {
    report.cleanupExitCode = 1;
    report.cleanupFailure = error.message;
    process.exitCode = 1;
  }
  save();
  console.log(JSON.stringify(report, null, 2));
}
