const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const User = require('../src/models/User');
const AuthSession = require('../src/models/AuthSession');
const config = require('../src/config/environment');
const jwt = require('jsonwebtoken');

describe('Auth Performance & Index Verification (Phase 9)', () => {
  let user;
  let session;
  let token;

  beforeAll(async () => {
    await db.connect();
    await User.syncIndexes();
    await AuthSession.syncIndexes();
  });

  afterAll(async () => {
    await db.closeDatabase();
  });

  beforeEach(async () => {
    await db.clearDatabase();
    user = await User.create({
      name: 'Benchmark User',
      email: 'bench@example.com',
      password: 'FixturePassword123!',
      role: 'user',
      tokenVersion: 0,
      isActive: true,
    });

    const sessionId = crypto.randomUUID();
    const refresh = crypto.randomBytes(48).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refresh).digest('hex');

    session = await AuthSession.create({
      sessionId,
      userId: user._id,
      tokenVersion: user.tokenVersion,
      refreshHash,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      persistent: false,
    });

    token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
        tokenVersion: user.tokenVersion,
        sid: session.sessionId,
      },
      config.jwt.secret,
      { expiresIn: '1h' },
    );
  });

  test('User.findById uses primary index _id_ and avoids COLLSCAN', async () => {
    const explain = await User.findById(user._id).explain('executionStats');
    const queryPlanner = explain.queryPlanner;
    const executionStats = explain.executionStats;

    // Check execution stats
    expect(executionStats.totalDocsExamined).toBeLessThanOrEqual(1);

    // Verify stage is IDHACK or IXSCAN on _id_
    const winningPlan = queryPlanner.winningPlan;
    const stages = [];
    function collectStages(plan) {
      if (!plan) return;
      if (plan.stage) stages.push(plan.stage);
      if (plan.inputStage) collectStages(plan.inputStage);
      if (plan.inputStages) plan.inputStages.forEach(collectStages);
    }
    collectStages(winningPlan);

    expect(stages).not.toContain('COLLSCAN');
    const usesIdIndex =
      winningPlan.stage === 'IDHACK' ||
      stages.includes('IXSCAN') ||
      winningPlan.inputStage?.indexName === '_id_';
    expect(usesIdIndex).toBe(true);
  });

  test('AuthSession query uses unique index sessionId_1 and avoids COLLSCAN', async () => {
    const explain = await AuthSession.findOne({
      sessionId: session.sessionId,
      userId: user._id,
      tokenVersion: user.tokenVersion,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).explain('executionStats');

    const queryPlanner = explain.queryPlanner;
    const executionStats = explain.executionStats;

    // Should examine at most 1 document due to unique index on sessionId
    expect(executionStats.totalDocsExamined).toBeLessThanOrEqual(1);

    const winningPlan = queryPlanner.winningPlan;
    const stages = [];
    let indexNameUsed = null;

    function collectPlan(plan) {
      if (!plan) return;
      if (plan.stage) stages.push(plan.stage);
      if (plan.indexName) indexNameUsed = plan.indexName;
      if (plan.inputStage) collectPlan(plan.inputStage);
      if (plan.inputStages) plan.inputStages.forEach(collectPlan);
    }
    collectPlan(winningPlan);

    expect(stages).not.toContain('COLLSCAN');
    expect(stages).toContain('IXSCAN');
    expect(indexNameUsed).toBe('sessionId_1');
  });

  test('Authenticated endpoint latency benchmark on local single node', async () => {
    const iterations = 100;
    const latencies = [];

    // Warm-up request
    const warmup = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(warmup.status).toBe(200);

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
      const end = process.hrtime.bigint();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ms = Number(end - start) / 1e6;
      latencies.push(ms);
    }

    latencies.sort((a, b) => a - b);

    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const mean = sum / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log('\n--- Local Single-Node Auth Benchmark Results (100 reqs) ---');
    console.log(`Min:    ${min.toFixed(2)} ms`);
    console.log(`Mean:   ${mean.toFixed(2)} ms`);
    console.log(`p50:    ${p50.toFixed(2)} ms`);
    console.log(`p95:    ${p95.toFixed(2)} ms`);
    console.log(`p99:    ${p99.toFixed(2)} ms`);
    console.log(`Max:    ${max.toFixed(2)} ms`);
    console.log('----------------------------------------------------------\n');

    expect(p50).toBeLessThan(50); // Generous local threshold
    expect(p95).toBeLessThan(100);
  });
});
