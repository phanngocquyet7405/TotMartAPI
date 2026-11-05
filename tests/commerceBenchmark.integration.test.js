const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const app = require('../src/app');
const db = require('./helpers/db');
const { createUser, signToken } = require('./helpers/factories');
const Product = require('../src/models/Product');
const catalog = require('../src/services/managerCatalogService');
let server, merchant, token, base, expected;
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const sourceHash = () =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync('src/controllers/managerController.js'))
    .update(fs.readFileSync('src/services/managerCatalogService.js'))
    .update(fs.readFileSync('src/models/Product.js'))
    .digest('hex');
beforeAll(async () => {
  if (process.env.TEST_MONGODB_URI)
    throw new Error('Benchmark requires a newly owned Mongo replica set');
  await db.connect();
  const records = [];
  const owners = [];
  for (let owner = 0; owner < 8; owner++) {
    const { user } = await createUser({ role: 'merchant' });
    owners.push(user);
    const brand = await require('../src/models/Brand').create({
      ownerId: user._id,
      name: `Benchmark ${owner}`,
      slug: `b06-benchmark-${owner}`,
    });
    for (let n = 0; n < 150; n++)
      records.push({
        _id: new mongoose.Types.ObjectId(),
        productId: `B06-${owner}-${n}`,
        slug: `b06-product-${owner}-${n}`,
        name: `Fixture product ${owner}-${n}`,
        brand: brand._id,
        ...(n >= 15 && n < 30 ? {} : { ownerId: n >= 30 && n < 45 ? owners[0]._id : user._id }),
        price: 10000 + n,
        stock: 100,
        instock: true,
        archivedAt: n < 15 ? new Date('2026-01-02') : null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        images: [],
      });
  }
  // Use the last owner: 15 archived, 15 legacy, 15 foreign direct-owner, 105 direct-owned.
  merchant = owners[7];
  token = signToken(merchant);
  await Product.collection.insertMany(records);
  const scope = await catalog.productScope(merchant._id);
  expected = (await Product.find(scope).sort({ createdAt: -1, _id: -1 }).select('_id')).map((p) =>
    String(p._id),
  );
  expect(expected).toHaveLength(120);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, 120000);
afterAll(async () => {
  mongoose.set('debug', false);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.closeDatabase();
});
async function page(number, limit = 20) {
  const response = await fetch(`${base}/api/manager/products?page=${number}&limit=${limit}`, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function measure(concurrency) {
  for (let n = 0; n < 5; n++) expect((await page(1)).status).toBe(200);
  const operations = {};
  mongoose.set('debug', (collection, method) => {
    const key = `${collection}.${method}`;
    operations[key] = (operations[key] || 0) + 1;
  });
  const times = [];
  let errors = 0;
  try {
    for (let batch = 0; batch < 40 / concurrency; batch++)
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const started = performance.now();
          const response = await page(1);
          times.push(performance.now() - started);
          if (response.status !== 200) errors++;
        }),
      );
  } finally {
    mongoose.set('debug', false);
  }
  expect(errors).toBe(0);
  const queries = Object.values(operations).reduce((sum, n) => sum + n, 0);
  // Source contract is one User lookup, one Brand scope, find + count; no row-count-dependent reads.
  expect(queries).toBe(160);
  return {
    concurrency,
    warmup: 5,
    samples: times.length,
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    errors,
    errorRate: errors / times.length,
    queries,
    queriesPerRequest: queries / times.length,
    operations,
  };
}
test('B06 measured manager query baseline/control and stable ownership pagination on a fixed dataset', async () => {
  const hashBefore = sourceHash();
  const before = [await measure(1), await measure(4)];
  const pages = [];
  for (let n = 1; n <= 7; n++) {
    const response = await page(n);
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(120);
    pages.push(...response.body.data.map((p) => p._id));
  }
  expect(new Set(pages).size).toBe(120);
  expect(pages).toEqual(expected);
  const filter = await catalog.productScope(merchant._id);
  const explain = await Product.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(20)
    .explain('executionStats');
  const after = [await measure(1), await measure(4)];
  expect(sourceHash()).toBe(hashBefore);
  const report = {
    route: 'GET /api/manager/products?page=1&limit=20',
    sourceHash: hashBefore,
    fixture: {
      products: 1200,
      owners: 8,
      productsPerBrand: 150,
      visibleToMeasuredOwner: 120,
      measuredBrand: {
        archived: 15,
        legacyWithoutOwner: 15,
        foreignDirectOwner: 15,
        currentDirectOwner: 105,
      },
      identicalCreatedAt: true,
      writesDuringPagination: false,
      mongo: 'disposable replica set 7.0.14',
      redis: 'disabled in this separate query benchmark',
    },
    indexes: await Product.collection.indexes(),
    before,
    after,
    comparison:
      'Unchanged-source repeat/control; no optimization/index added. Local latency is not a production SLO.',
    executionStats: {
      nReturned: explain.executionStats.nReturned,
      totalKeysExamined: explain.executionStats.totalKeysExamined,
      totalDocsExamined: explain.executionStats.totalDocsExamined,
      executionTimeMillis: explain.executionStats.executionTimeMillis,
    },
    winningPlan: explain.queryPlanner.winningPlan,
    pagination: { rows: pages.length, unique: new Set(pages).size, exactStableOrder: true },
  };
  if (process.env.B05_SERVER_RESOURCE_FILE)
    fs.writeFileSync(
      path.join(path.dirname(process.env.B05_SERVER_RESOURCE_FILE), 'b06-benchmark.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
}, 60000);
