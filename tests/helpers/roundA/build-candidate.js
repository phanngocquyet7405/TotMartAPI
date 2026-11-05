const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { sourceManifest, sha256 } = require('../../../scripts/evidence-manifest');
const run = randomUUID();
const tag = `totmart-a-candidate:${run}${process.argv.includes('--final') ? '-final' : ''}`;
const secretMarkers = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
const result = { run, tag, commands: [], buildExitCode: null, cleanupExitCode: 0 };
const manifest = sourceManifest();
result.sourceManifestSha256 = sha256(JSON.stringify(manifest, null, 2) + '\n');
result.runtimeSourceHashes = Object.fromEntries(
  [
    'src/utils/logger.js',
    'src/middleware/errorHandler.js',
    'src/services/userIdentityService.js',
  ].map((file) => [file, sha256(fs.readFileSync(file))]),
);
const save = () =>
  fs.writeFileSync('artifacts/round-a/candidate.json', JSON.stringify(result, null, 2) + '\n');
function docker(args, options = {}) {
  try {
    const value = execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    result.commands.push({ operation: args.slice(0, 2).join(' '), exitCode: 0 });
    return value.trim();
  } catch (error) {
    result.commands.push({ operation: args.slice(0, 2).join(' '), exitCode: error.status ?? null });
    throw new Error(`Docker ${args[0]} failed`, { cause: error });
  }
}
const tarFile = path.resolve('artifacts/round-a/candidate.image.tar');
let containerId;
const containerName = `totmart-a-${run}-bcrypt`;
function verifyContainer() {
  const metadata = JSON.parse(
    docker([
      'inspect',
      '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}}}',
      containerId,
    ]),
  );
  if (
    metadata.id !== containerId ||
    metadata.name !== '/' + containerName ||
    metadata.labels?.['totmart.test.run'] !== run
  )
    throw new Error('Candidate probe ownership mismatch');
}
try {
  console.log('Candidate build started; no fixture credentials passed to build');
  if (!process.argv.includes('--inspect-existing'))
    docker(
      [
        'build',
        '--label',
        `totmart.test.run=${run}`,
        '--label',
        `totmart.test.source=${result.sourceManifestSha256}`,
        '--tag',
        tag,
        '.',
      ],
      { timeout: 600000 },
    );
  result.buildExitCode = 0;
  result.image = JSON.parse(
    docker([
      'image',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"user":{{json .Config.User}},"labels":{{json .Config.Labels}},"cmd":{{json .Config.Cmd}}}',
      tag,
    ]),
  );
  if (
    result.image.labels['totmart.test.run'] !== run ||
    result.image.user !== 'node' ||
    JSON.stringify(result.image.cmd) !== JSON.stringify(['node', 'src/server.js'])
  )
    throw new Error('Candidate runtime policy mismatch');
  const history = docker([
    'history',
    '--no-trunc',
    '--format',
    '{{json .CreatedBy}}',
    result.image.id,
  ]);
  result.history = {
    entries: history.split('\n').length,
    fixtureSecretMatches: secretMarkers.filter((marker) => history.includes(marker)).length,
    fixtureCredentialsPassedToBuild: false,
  };
  containerId = docker([
    'create',
    '--name',
    containerName,
    '--label',
    `totmart.test.run=${run}`,
    '--network',
    'none',
    result.image.id,
    'node',
    '-e',
    "const fs=require('fs'),c=require('crypto');const b=require('bcrypt');const h=b.hashSync('synthetic-bcrypt-probe',10);const forbidden=['.env','artifacts','tests','coverage'].filter(p=>fs.existsSync('/app/'+p));const runtimeSourceHashes=Object.fromEntries(['src/utils/logger.js','src/middleware/errorHandler.js','src/services/userIdentityService.js'].map(p=>[p,c.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')]));console.log(JSON.stringify({node:process.version,uid:process.getuid(),bcryptLoaded:true,bcryptHashCompare:b.compareSync('synthetic-bcrypt-probe',h),forbiddenApplicationPaths:forbidden,runtimeSourceHashes}));",
  ]);
  result.probe = { id: containerId, name: containerName, owner: run, cleaned: false };
  save();
  verifyContainer();
  result.runtime = JSON.parse(docker(['start', '--attach', containerId]));
  if (
    JSON.stringify(result.runtime.runtimeSourceHashes) !==
    JSON.stringify(result.runtimeSourceHashes)
  )
    throw new Error('Candidate runtime source hashes differ from working tree');
  const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', containerId]));
  if (
    state.ExitCode !== 0 ||
    !result.runtime.bcryptHashCompare ||
    result.runtime.uid === 0 ||
    !result.runtime.node.startsWith('v24.') ||
    result.runtime.forbiddenApplicationPaths.length
  )
    throw new Error('Candidate native dependency or filesystem check failed');
  verifyContainer();
  docker(['rm', containerId]);
  result.probe.cleaned = true;
  containerId = undefined;
  docker(['image', 'save', '--output', tarFile, result.image.id], { timeout: 120000 });
  let entries = 0,
    layers = 0,
    matches = 0;
  const vendorAssets = [];
  const vendorGzip = 'app/node_modules/bcryptjs/dist/bcrypt.min.js.gz';
  const vendorHash = createHash('sha256')
    .update(fs.readFileSync('node_modules/bcryptjs/dist/bcrypt.min.js.gz'))
    .digest('hex');
  const forbidden = [];
  function tar(buffer, inspectLayer = false) {
    for (let offset = 0; offset + 512 <= buffer.length;) {
      const header = buffer.subarray(offset, offset + 512);
      if (header.every((byte) => byte === 0)) break;
      const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
      const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim();
      const size = parseInt(sizeText || '0', 8);
      if (!Number.isFinite(size) || size < 0 || offset + 512 + size > buffer.length)
        throw new Error('Invalid image archive entry');
      const body = buffer.subarray(offset + 512, offset + 512 + size);
      entries++;
      for (const marker of secretMarkers) if (body.includes(Buffer.from(marker))) matches++;
      if (inspectLayer && name === vendorGzip) {
        const hash = createHash('sha256').update(body).digest('hex');
        vendorAssets.push({
          file: name,
          sha256: hash,
          matchesLockedInstalledDependency: hash === vendorHash,
        });
        if (hash !== vendorHash) forbidden.push(name);
      } else if (
        inspectLayer &&
        /^\.?\/?app\/(?:\.env(?:\.|$)|artifacts\/|coverage\/|tests\/|.*\.(?:archive|gz|bak|dump)$)/.test(
          name,
        )
      )
        forbidden.push(name);
      if (!inspectLayer && body.length > 2 && body[0] === 31 && body[1] === 139) {
        layers++;
        tar(zlib.gunzipSync(body), true);
      } else if (!inspectLayer && name.endsWith('.tar')) {
        layers++;
        tar(body, true);
      } else if (
        !inspectLayer &&
        body.length > 262 &&
        body.subarray(257, 262).toString() === 'ustar'
      ) {
        layers++;
        tar(body, true);
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  }
  tar(fs.readFileSync(tarFile));
  result.layers = {
    inspectedLayers: layers,
    inspectedTarEntries: entries,
    fixtureSecretMatches: matches,
    forbiddenApplicationPaths: forbidden,
    verifiedPublicVendorAssets: vendorAssets,
    hostNodeModulesCopied: false,
    dockerfileCopySources: ['package.json', 'package-lock.json', 'src', 'scripts'],
  };
  if (!layers || matches || forbidden.length || result.history.fixtureSecretMatches)
    throw new Error('Candidate layer hygiene failed');
  result.exitCode = 0;
} catch (error) {
  result.exitCode = 1;
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  try {
    if (containerId) {
      verifyContainer();
      docker(['rm', '-f', containerId]);
      result.probe.cleaned = true;
    }
    if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);
  } catch {
    result.cleanupExitCode = 1;
    process.exitCode = 1;
  }
  save();
  console.log(JSON.stringify(result, null, 2));
}
