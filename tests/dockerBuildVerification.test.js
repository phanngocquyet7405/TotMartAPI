const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

describe('Docker Build & Image Optimization (Phase 5)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  const dockerignorePath = path.join(rootDir, '.dockerignore');

  test('Dockerfile uses multi-stage build with node:24-bookworm-slim and non-root user', () => {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

    // Multi-stage builder & runner
    expect(dockerfile).toMatch(/FROM\s+node:24-bookworm-slim\s+AS\s+builder/i);
    expect(dockerfile).toMatch(/FROM\s+node:24-bookworm-slim\s+AS\s+runner/i);

    // Dependencies copied from builder, scripts excluded from production image
    expect(dockerfile).toMatch(/COPY\s+--from=builder/);
    expect(dockerfile).not.toMatch(/COPY.*scripts.*src/);

    // Security & runtime standards
    expect(dockerfile).toMatch(/USER\s+node/);
    expect(dockerfile).toMatch(/EXPOSE\s+3001/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/CMD\s+\["node",\s*"src\/server\.js"\]/);
  });

  test('.dockerignore excludes non-production artifacts, docs, scripts, tests and secrets', () => {
    const dockerignore = fs.readFileSync(dockerignorePath, 'utf8');
    const lines = dockerignore
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const requiredPatterns = [
      '.git',
      '.env*',
      'node_modules',
      'coverage',
      'artifacts',
      'tests',
      'docs',
      'scripts',
      '*.md',
    ];

    for (const pattern of requiredPatterns) {
      expect(lines).toContain(pattern);
    }
  });

  test('Docker image totmart-api:phase5 runs as node user with functional bcrypt', () => {
    let dockerAvailable;
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      dockerAvailable = true;
    } catch {
      dockerAvailable = false;
    }

    if (!dockerAvailable) {
      console.warn('Docker daemon not running; skipping runtime image verification');
      return;
    }

    // Verify user and command metadata
    const inspectOutput = execSync(
      'docker inspect --format "{{json .Config.User}}|||{{json .Config.Cmd}}" totmart-api:phase5',
      { encoding: 'utf8', timeout: 10000 },
    ).trim();

    const [user, cmd] = inspectOutput.split('|||');
    expect(JSON.parse(user)).toBe('node');
    expect(JSON.parse(cmd)).toEqual(['node', 'src/server.js']);

    // Verify bcrypt execution and uid inside the built container
    const runtimeProbe = execSync(
      "docker run --rm totmart-api:phase5 node -e \"const b = require('bcrypt'); console.log(JSON.stringify({ uid: process.getuid(), bcryptOk: !!b.hashSync('test', 10) }))\"",
      { encoding: 'utf8', timeout: 15000 },
    ).trim();

    const probe = JSON.parse(runtimeProbe);
    expect(probe.uid).toBe(1000);
    expect(probe.bcryptOk).toBe(true);

    // Verify forbidden files are absent from /app/
    const forbiddenProbe = execSync(
      "docker run --rm totmart-api:phase5 node -e \"const fs = require('fs'); const f = ['.env', 'artifacts', 'tests', 'coverage', 'docs', 'scripts'].filter(p => fs.existsSync('/app/' + p)); console.log(JSON.stringify(f))\"",
      { encoding: 'utf8', timeout: 15000 },
    ).trim();

    expect(JSON.parse(forbiddenProbe)).toEqual([]);
  });
});
