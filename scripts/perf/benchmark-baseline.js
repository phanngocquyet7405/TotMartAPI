'use strict';

const { fork } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

const rootDir = path.resolve(__dirname, '../..');
const JWT_SECRET = 'fixture-auth-key-for-server-process-12345';
const JWT_REFRESH_SECRET = 'fixture-refresh-key-for-server-process-67890';

let currentStep = 'Khởi tạo script';

function setStep(name) {
  currentStep = name;
  console.log(`\n[STEP] >>> ${name} (${new Date().toISOString()})`);
}

async function withStepTimeout(stepName, fn, timeoutMs = 30000) {
  setStep(stepName);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout ${timeoutMs}ms tại bước: ${stepName}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// 1. Timeout cứng 120s cho toàn script
const globalTimer = setTimeout(() => {
  console.error(`\n[FATAL] Script đạt timeout cứng 120s! Bước đang kẹt: ${currentStep}`);
  process.exit(1);
}, 120000);
globalTimer.unref();

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

function calcPercentiles(arr) {
  if (!arr.length) return { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const idx = (p) => Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return {
    min: sorted[0],
    mean: sum / sorted.length,
    p50: sorted[idx(0.5)],
    p90: sorted[idx(0.9)],
    p95: sorted[idx(0.95)],
    p99: sorted[idx(0.99)],
    max: sorted[sorted.length - 1],
  };
}

async function benchmarkEndpoint({ name, url, options, iterations = 100, warmup = 10 }) {
  console.log(`  Đang đo ${name} (${iterations} requests, ${warmup} warmup)...`);
  for (let i = 0; i < warmup; i++) {
    const opt = typeof options === 'function' ? options(i, true) : options;
    try {
      const res = await fetch(url, opt);
      await res.text();
    } catch {
      // ignore warmup error
    }
  }

  const latencies = [];
  const startTotal = performance.now();
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < iterations; i++) {
    const opt = typeof options === 'function' ? options(i, false) : options;
    const t0 = performance.now();
    try {
      const res = await fetch(url, opt);
      await res.text();
      const t1 = performance.now();
      latencies.push(t1 - t0);
      if (res.ok) successCount++;
      else errorCount++;
    } catch {
      const t1 = performance.now();
      latencies.push(t1 - t0);
      errorCount++;
    }
  }
  const totalDuration = performance.now() - startTotal;
  const stats = calcPercentiles(latencies);
  const rps = (iterations / totalDuration) * 1000;

  return {
    name,
    iterations,
    successCount,
    errorCount,
    totalDurationMs: Math.round(totalDuration),
    rps: Math.round(rps * 10) / 10,
    minMs: Math.round(stats.min * 100) / 100,
    meanMs: Math.round(stats.mean * 100) / 100,
    p50Ms: Math.round(stats.p50 * 100) / 100,
    p90Ms: Math.round(stats.p90 * 100) / 100,
    p95Ms: Math.round(stats.p95 * 100) / 100,
    p99Ms: Math.round(stats.p99 * 100) / 100,
    maxMs: Math.round(stats.max * 100) / 100,
  };
}

async function main() {
  let replSet;
  let redisLease;
  let child;
  let mongoUri;
  let hasRedis = false;
  let redisUrl = '';

  try {
    // Bước 1: Khởi động MongoMemoryReplSet (MongoDB 7.0.14)
    await withStepTimeout('1. Khởi động MongoMemoryReplSet (MongoDB 7.0.14)', async () => {
      replSet = new MongoMemoryReplSet({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        binary: { version: '7.0.14' },
      });
      await replSet.start();
      mongoUri = replSet.getUri();
      console.log(`[Mongo] MongoMemoryReplSet đã khởi động: ${mongoUri}`);
    });

    // Bước 2: Kiểm tra Redis disposable
    await withStepTimeout('2. Kiểm tra Redis disposable (Docker)', async () => {
      try {
        const { disposableRedis } = require(path.join(rootDir, 'tests/helpers/disposableRedis'));
        redisLease = await disposableRedis({ purpose: 'bench' });
        redisUrl = redisLease.url;
        hasRedis = true;
        console.log(`[Redis] Docker disposable Redis thành công: ${redisUrl}`);
      } catch (redisErr) {
        hasRedis = false;
        redisUrl = '';
        console.log(
          `[Redis] Docker disposable Redis không khả dụng (${redisErr.message.split('\n')[0]}).`,
        );
        console.log(
          '[Redis] Chạy ở chế độ KHÔNG REDIS (số liệu benchmark ghi nhận không có Redis).',
        );
      }
    });

    // Bước 3: Seed dữ liệu kiểm thử (User, Session, Product, Cart)
    let user, authToken;
    await withStepTimeout('3. Seed dữ liệu kiểm thử', async () => {
      await mongoose.connect(mongoUri);
      const User = require(path.join(rootDir, 'src/models/User'));
      const AuthSession = require(path.join(rootDir, 'src/models/AuthSession'));
      const Category = require(path.join(rootDir, 'src/models/Category'));
      const Brand = require(path.join(rootDir, 'src/models/Brand'));
      const Product = require(path.join(rootDir, 'src/models/Product'));
      const Cart = require(path.join(rootDir, 'src/models/Cart'));
      const passwordService = require(path.join(rootDir, 'src/services/passwordService'));

      await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

      const hashedPassword = await passwordService.hashPassword('Password123!');
      user = await User.create({
        name: 'Benchmark User',
        email: 'bench@example.com',
        password: hashedPassword,
        role: 'user',
        tokenVersion: 0,
        isActive: true,
      });

      const sessionId = crypto.randomUUID();
      const refresh = crypto.randomBytes(48).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refresh).digest('hex');

      const session = await AuthSession.create({
        sessionId,
        userId: user._id,
        tokenVersion: user.tokenVersion,
        refreshHash,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        persistent: false,
      });

      authToken = jwt.sign(
        {
          userId: user._id,
          role: user.role,
          name: user.name,
          email: user.email,
          tokenVersion: user.tokenVersion,
          sid: session.sessionId,
        },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      const category = await Category.create({
        name: 'Danh Mục Benchmark',
        isActive: true,
      });

      const brand = await Brand.create({
        name: 'TotMart Brand',
        description: 'Thương hiệu thử nghiệm',
        ownerId: user._id,
      });

      const product = await Product.create({
        ownerId: user._id,
        productId: 'PROD-BENCH-001',
        name: 'Sản phẩm Benchmark',
        price: 150000,
        brand: brand._id,
        category: category._id,
        stock: 100,
        instock: true,
        images: [{ url: 'https://example.com/p.jpg', public_id: 'img1' }],
      });

      await Cart.create({
        userId: user._id,
        items: [
          {
            productId: product._id,
            quantity: 2,
            lineId: 'line-1',
          },
        ],
        totalPrice: 300000,
        isSubscribeCart: false,
      });

      await mongoose.disconnect();
      console.log('[Seed] Đã tạo xong User, AuthSession, Product, Cart.');
    });

    // Bước 4: Spawn tiến trình server.js
    const port = await freePort();
    const startupPhases = {};
    let portOpenMs = null;
    let serverStartTime = 0;

    await withStepTimeout('4. Spawn server.js và chờ port mở', async () => {
      serverStartTime = performance.now();
      const env = {
        ...process.env,
        PORT: String(port),
        MONGODB_URI: mongoUri,
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        TRUST_PROXY: '1',
        REDIS_URL: redisUrl,
        REDIS_NAMESPACE: 'fixture:bench',
        JWT_SECRET,
        JWT_REFRESH_SECRET,
        CLOUDINARY_CLOUD_NAME: 'fixture',
        CLOUDINARY_API_KEY: 'fixture',
        CLOUDINARY_API_SECRET: 'fixture',
        SEPAY_API_KEY: 'fixture',
        SEPAY_BANK_ACCOUNT: '0000000000',
        SEPAY_BANK_NAME: 'Fixture',
        FRONTEND_URL: 'http://localhost:3000',
      };

      const noDotenvPath = path.join(rootDir, 'tests/helpers/noDotenv.js');
      child = fork(path.join(rootDir, 'src/server.js'), [], {
        cwd: rootDir,
        env,
        execArgv: ['--require', noDotenvPath],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });

      console.log(`[Spawn] Server spawned (PID: ${child.pid}) trên port ${port}`);

      const onLine = (line) => {
        try {
          const data = JSON.parse(line);
          if (data.event === 'startup_phase') {
            startupPhases[data.phase] = data.ms;
            if (data.phase === 'portOpen') {
              portOpenMs = data.ms;
            }
          }
        } catch {
          // non-json
        }
      };

      child.stdout.on('data', (d) => {
        const text = d.toString();
        process.stdout.write(`[SERVER] ${text}`);
        text.split('\n').forEach(onLine);
      });
      child.stderr.on('data', (d) => {
        const text = d.toString();
        process.stderr.write(`[SERVER ERR] ${text}`);
        text.split('\n').forEach(onLine);
      });

      // Chờ port mở
      const deadline = performance.now() + 25000;
      while (performance.now() < deadline && child.exitCode === null) {
        if (portOpenMs !== null) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      if (portOpenMs === null) {
        throw new Error(`Port chưa mở sau 25s (child exitCode: ${child.exitCode})`);
      }
      console.log(`[Port] Port ${port} đã mở tại ${portOpenMs} ms`);
    });

    // Bước 5: Kiểm tra Liveness (GET /api/home/live -> 200)
    let liveMs = null;
    await withStepTimeout('5. Kiểm tra Liveness 200 (GET /api/home/live)', async () => {
      const deadline = performance.now() + 25000;
      while (performance.now() < deadline && child.exitCode === null) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/home/live`, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.status === 200) {
            liveMs = Math.round(performance.now() - serverStartTime);
            console.log(`[Liveness] 200 OK tại ${liveMs} ms`);
            return;
          }
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Liveness không trả về 200');
    });

    // Bước 6: Kiểm tra Readiness (GET /api/home/health -> 200)
    let readyMs = null;
    await withStepTimeout('6. Kiểm tra Readiness 200 (GET /api/home/health)', async () => {
      const deadline = performance.now() + 25000;
      while (performance.now() < deadline && child.exitCode === null) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/home/health`, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.status === 200) {
            readyMs = Math.round(performance.now() - serverStartTime);
            console.log(`[Readiness] 200 OK tại ${readyMs} ms`);
            return;
          }
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Readiness không trả về 200');
    });

    // Bước 7: Thực hiện benchmark đo độ trễ các endpoint
    let benchmarkResults = [];
    await withStepTimeout('7. Đo đạc p50/p95 các endpoint', async () => {
      // 1. Liveness
      const liveBench = await benchmarkEndpoint({
        name: 'GET /api/home/live (Liveness)',
        url: `http://127.0.0.1:${port}/api/home/live`,
        options: { method: 'GET' },
        iterations: 100,
      });

      // 2. Readiness
      const healthBench = await benchmarkEndpoint({
        name: 'GET /api/home/health (Readiness)',
        url: `http://127.0.0.1:${port}/api/home/health`,
        options: { method: 'GET' },
        iterations: 100,
      });

      // 3. Catalog công khai
      const catalogBench = await benchmarkEndpoint({
        name: 'GET /api/products/get-all-products/ (Catalog công khai)',
        url: `http://127.0.0.1:${port}/api/products/get-all-products/`,
        options: { method: 'GET' },
        iterations: 100,
      });

      // 4. POST /api/home/login
      const loginBench = await benchmarkEndpoint({
        name: 'POST /api/home/login (Login)',
        url: `http://127.0.0.1:${port}/api/home/login`,
        options: (i) => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `192.168.1.${(i % 250) + 1}`,
          },
          body: JSON.stringify({
            email: 'bench@example.com',
            password: 'Password123!',
          }),
        }),
        iterations: 50,
      });

      // 5. Authenticated Cart
      const cartBench = await benchmarkEndpoint({
        name: 'GET /api/carts/get-cart/:id (Cart có auth)',
        url: `http://127.0.0.1:${port}/api/carts/get-cart/${user._id}`,
        options: {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
        iterations: 100,
      });

      // 6. Authenticated User Profile
      const userBench = await benchmarkEndpoint({
        name: 'GET /api/users/get-user-by-id/:id (User profile có auth)',
        url: `http://127.0.0.1:${port}/api/users/get-user-by-id/${user._id}`,
        options: {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
        iterations: 100,
      });

      benchmarkResults = [liveBench, healthBench, catalogBench, loginBench, cartBench, userBench];
    });

    const finalReport = {
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        mongoVersion: '7.0.14 (MongoMemoryReplSet 1 node wiredTiger)',
        hasRedis,
        redisType: hasRedis ? 'Docker Disposable Redis' : 'Không có Redis (Docker unavailable)',
      },
      startup: {
        phases: startupPhases,
        portOpenMs: portOpenMs || liveMs,
        liveness200Ms: liveMs,
        readiness200Ms: readyMs,
      },
      endpoints: benchmarkResults,
    };

    console.log('\n======================================================');
    console.log('             KẾT QUẢ BASELINE (LOCAL NODE)            ');
    console.log('======================================================');
    console.log(JSON.stringify(finalReport, null, 2));

    const fs = require('node:fs');
    const outDir = path.join(rootDir, 'docs/perf');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, '00-baseline.json'),
      JSON.stringify(finalReport, null, 2),
      'utf8',
    );
    console.log(`\n[Report] Đã lưu kết quả thô vào docs/perf/00-baseline.json`);

    return finalReport;
  } finally {
    // Dọn dẹp
    if (child && child.exitCode === null) {
      console.log('[Cleanup] Đang tắt child server...');
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
    if (replSet) {
      console.log('[Cleanup] Đang dừng MongoMemoryReplSet...');
      await replSet.stop();
    }
    if (redisLease?.cleanup) {
      console.log('[Cleanup] Đang dọn dẹp Redis lease...');
      await redisLease.cleanup();
    }
    clearTimeout(globalTimer);
    console.log('[Cleanup] Hoàn tất dọn dẹp.');
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n>>> BENCHMARK HOÀN TẤT THÀNH CÔNG <<<');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n[ERROR] Benchmark thất bại tại bước [${currentStep}]:`, err);
      process.exit(1);
    });
}

module.exports = { main };
