// Real image/app HTTP assertions. Only fixture state lives in this container's tmpfs.
const fs = require('node:fs');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { A, F } = require('./client');
const assert = require('node:assert/strict');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checkpoint = 'setup';
const journal = [];
async function main() {
  const rows = journal;
  try {
    await A.db.connect();
    const admin = (await F.createUser({ role: 'admin' })).user;
    const merchant = (await F.createUser({ role: 'merchant' })).user;
    const brand = await F.createBrand({ ownerId: merchant._id });
    const product = await F.createProduct(brand, { stock: 100 });
    const category = await require('/app/src/models/Category').create({
      name: 'CSOT category ' + crypto.randomUUID(),
    });
    const base = [
      { path: '/api/orders/', method: 'GET' },
      { path: '/api/home/logout', method: 'POST' },
      { path: '/api/admin/operations/health-summary', method: 'GET' },
      { path: '/api/admin/notifications/stream-ticket', method: 'GET' },
    ];
    const cases = base.flatMap((route) =>
      ['users', 'authsessions'].map((collection) => ({
        ...route,
        collection,
        read:
          collection === 'users' ? 'authenticate.User.findById' : 'authenticate.AuthSession.exists',
        user: admin,
      })),
    );
    cases.push(
      {
        path: '/api/manager/products/' + product._id,
        method: 'PUT',
        body: { name: 'CSOT updated product' },
        collection: 'brands',
        read: 'ownProduct.productScope.Brand.find',
        user: merchant,
      },
      {
        path: '/api/manager/products/' + product._id,
        method: 'PUT',
        body: { name: 'CSOT updated product' },
        collection: 'products',
        read: 'ownProduct.requireProduct.Product.findOne',
        user: merchant,
      },
      {
        path: '/api/manager/products',
        method: 'POST',
        body: {
          name: 'CSOT new product',
          description: 'Synthetic',
          price: 100,
          stock: 1,
          brand: String(brand._id),
          category: String(category._id),
        },
        collection: 'brands',
        read: 'ownReferences.requireBrand.Brand.exists',
        user: merchant,
      },
      {
        path: '/api/manager/products',
        method: 'POST',
        body: {
          name: 'CSOT new product',
          description: 'Synthetic',
          price: 100,
          stock: 1,
          brand: String(brand._id),
          category: String(category._id),
        },
        collection: 'categories',
        read: 'ownReferences.Category.exists',
        user: merchant,
      },
    );
    const control = mongoose.connection.db.admin();
    for (let n = 0; n < cases.length; n++) {
      const item = cases[n],
        trace = crypto.randomUUID(),
        index = n % 2;
      // Fresh DB-backed sid for every case: red logout may legitimately remove its own sid.
      const user = (await F.createUser({ role: item.user.role })).user;
      const subject = item.read.startsWith('authenticate') ? user : item.user;
      if (!item.read.startsWith('authenticate')) await A.seedSession(subject);
      const jwt = A.token(subject),
        sid = require('jsonwebtoken').decode(jwt).sid;
      const row = {
        read: item.read,
        index,
        path: item.path,
        method: item.method,
        trace,
        deadlineMs: 27000,
        blockTimeMS: 20000,
      };
      rows.push(row);
      row.violations = [];
      checkpoint = item.read + ':before-products';
      const beforeProducts = await require('/app/src/models/Product').countDocuments();
      const beforeName = (await require('/app/src/models/Product').findById(product._id)).name;
      checkpoint = item.read + ':arm';
      const point = await control.command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: {
          failCommands: ['find'],
          namespace: mongoose.connection.name + '.' + item.collection,
          appName: 'totmart-fixture-' + (index ? 'staging' : 'production'),
          blockConnection: true,
          blockTimeMS: row.blockTimeMS,
        },
      });
      let pending;
      try {
        row.startedAt = Date.now();
        pending = A.http(
          index,
          item.path,
          item.method,
          item.body,
          { Authorization: 'Bearer ' + jwt, 'X-Fixture-Trace': trace },
          row.deadlineMs,
        ).then(
          (response) => ({ response }),
          (error) => ({ errorType: error.code || error.name }),
        );
        checkpoint = item.read + ':barrier';
        await control.command({
          waitForFailPoint: 'failCommand',
          timesEntered: point.count + 1,
          maxTimeMS: 4000,
        });
        row.barrierAt = Date.now();
        checkpoint = item.read + ':await-http';
        const outcome = await pending;
        row.endedAt = Date.now();
        row.durationMs = row.endedAt - row.startedAt;
        row.status = outcome.response?.status ?? null;
        row.errorType = outcome.errorType ?? null;
        row.requestId = outcome.response?.headers['x-request-id'] || null;
        row.body =
          row.status >= 500
            ? outcome.response.body
            : { success: outcome.response?.body?.success, dataRedacted: true };
        row.violations = [];
        if (row.status !== 503) row.violations.push('expected safe 503');
        if (row.durationMs < 4500 || row.durationMs > 8000)
          row.violations.push('expected CSOT near 5000ms');
        if (!/^[a-f0-9-]{36}$/.test(row.requestId || '')) row.violations.push('missing requestId');
        if (
          row.status === 503 &&
          (row.body.success !== false ||
            row.body.status !== 503 ||
            row.body.requestId !== row.requestId ||
            row.body.message !== 'Lỗi hệ thống. Vui lòng thử lại.')
        )
          row.violations.push('unsafe/mismatched 503 envelope');
      } finally {
        // configureFailPoint off waits for active failpoint readers. The fixture control
        // socket has an 8s timeout; finish the existing 20s server sleep before disabling.
        // HTTP outcome/deadline assertions above remain unchanged and already recorded.
        await sleep(Math.max(0, row.startedAt + row.blockTimeMS + 300 - Date.now()));
        checkpoint = item.read + ':disable-failpoint';
        await control.command({ configureFailPoint: 'failCommand', mode: 'off' });
        // Disabling the point does not cancel blockTimeMS already sleeping on the server.
        if (pending) await pending;
        checkpoint = item.read + ':ping';
        row.recovered = (await control.command({ ping: 1 })).ok === 1;
        const Session = require('/app/src/models/AuthSession');
        checkpoint = item.read + ':revoke';
        const revoked = await Session.updateOne(
          { userId: subject._id, sessionId: sid },
          { $set: { revokedAt: new Date() } },
        );
        row.revocationRecordMatched = revoked.matchedCount;
        checkpoint = item.read + ':deny-revoked';
        const denied = await A.http(index, '/api/orders/', 'GET', undefined, {
          Authorization: 'Bearer ' + jwt,
        });
        row.revokedAccessStatus = denied.status;
        if (denied.status !== 401) row.violations.push('DB revocation not enforced');
        if (item.read.startsWith('own')) {
          const unchanged =
            beforeProducts === (await require('/app/src/models/Product').countDocuments()) &&
            beforeName === (await require('/app/src/models/Product').findById(product._id)).name;
          row.controllerStateUnchanged = unchanged;
          if (!unchanged) row.violations.push('controller mutation after failed guard');
        }
        fs.writeFileSync('/fixture/auth-csot-result.json', JSON.stringify({ rows }));
      }
    }
  } finally {
    fs.writeFileSync('/fixture/auth-csot-result.json', JSON.stringify({ rows, checkpoint }));
    await A.db.closeDatabase();
  }
  fs.writeFileSync('/fixture/auth-csot-result.json', JSON.stringify({ rows }));
  console.log(
    'AUTH_CSOT_RESULT=' +
      JSON.stringify({ rows, passed: rows.every((row) => row.violations.length === 0) }),
  );
  assert(rows.length === 12);
}
main().catch((error) => {
  fs.writeFileSync(
    '/fixture/auth-csot-fatal.json',
    JSON.stringify({ type: error.name, code: error.code, checkpoint }),
  );
  process.exitCode = 1;
});
