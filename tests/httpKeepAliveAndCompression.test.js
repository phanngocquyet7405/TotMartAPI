const request = require('supertest');
const http = require('node:http');
const app = require('../src/app');
const db = require('./helpers/db');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const { resolveEnvironment } = require('../src/config/resolveEnvironment');
const { issueSseTicket } = require('../src/utils/notify');

describe('HTTP Layer: Keep-Alive and Compression (Phase 2)', () => {
  describe('(a) Keep-Alive and Headers Timeout Configuration', () => {
    test('defaults keepAliveTimeoutMs to 65000 and headersTimeoutMs to 66000', () => {
      const config = resolveEnvironment({
        NODE_ENV: 'test',
        JWT_SECRET: 'fixture-secret-12345',
        JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
      });
      expect(config.http.keepAliveTimeoutMs).toBe(65000);
      expect(config.http.headersTimeoutMs).toBe(66000);
    });

    test('accepts custom valid HTTP keep-alive timeouts via environment variables', () => {
      const config = resolveEnvironment({
        NODE_ENV: 'test',
        JWT_SECRET: 'fixture-secret-12345',
        JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
        HTTP_KEEP_ALIVE_TIMEOUT_MS: '75000',
        HTTP_HEADERS_TIMEOUT_MS: '76000',
      });
      expect(config.http.keepAliveTimeoutMs).toBe(75000);
      expect(config.http.headersTimeoutMs).toBe(76000);
    });

    test('rejects HTTP_HEADERS_TIMEOUT_MS when less than or equal to HTTP_KEEP_ALIVE_TIMEOUT_MS', () => {
      expect(() =>
        resolveEnvironment({
          NODE_ENV: 'test',
          JWT_SECRET: 'fixture-secret-12345',
          JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
          HTTP_KEEP_ALIVE_TIMEOUT_MS: '65000',
          HTTP_HEADERS_TIMEOUT_MS: '65000',
        }),
      ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);

      expect(() =>
        resolveEnvironment({
          NODE_ENV: 'test',
          JWT_SECRET: 'fixture-secret-12345',
          JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
          HTTP_KEEP_ALIVE_TIMEOUT_MS: '70000',
          HTTP_HEADERS_TIMEOUT_MS: '60000',
        }),
      ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
    });

    test('rejects out of bounds timeout numbers', () => {
      expect(() =>
        resolveEnvironment({
          NODE_ENV: 'test',
          JWT_SECRET: 'fixture-secret-12345',
          JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
          HTTP_KEEP_ALIVE_TIMEOUT_MS: '500', // min is 1000
        }),
      ).toThrow(/HTTP_KEEP_ALIVE_TIMEOUT_MS/);
    });

    test('httpServer receives configured keepAliveTimeout and headersTimeout values', (done) => {
      const config = resolveEnvironment({
        NODE_ENV: 'test',
        JWT_SECRET: 'fixture-secret-12345',
        JWT_REFRESH_SECRET: 'fixture-refresh-secret-67890',
        HTTP_KEEP_ALIVE_TIMEOUT_MS: '68000',
        HTTP_HEADERS_TIMEOUT_MS: '70000',
      });
      const server = http.createServer(app);
      server.keepAliveTimeout = config.http.keepAliveTimeoutMs;
      server.headersTimeout = config.http.headersTimeoutMs;

      server.listen(0, '127.0.0.1', () => {
        try {
          expect(server.keepAliveTimeout).toBe(68000);
          expect(server.headersTimeout).toBe(70000);
          expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
          server.close(done);
        } catch (err) {
          server.close(() => done(err));
        }
      });
    });
  });

  describe('(b) Response Compression Middleware', () => {
    beforeAll(async () => {
      await db.connect();
    });

    afterAll(async () => {
      await db.closeDatabase();
    });

    test('compresses large JSON responses (>1KB) when Accept-Encoding includes gzip', async () => {
      const user = await User.create({
        name: 'Compression Tester',
        email: 'gzip-test@example.com',
        password: 'Password123!',
        role: 'user',
        isActive: true,
      });

      for (let i = 0; i < 3; i++) {
        await Product.create({
          ownerId: user._id,
          productId: `GZIP-PROD-${i}`,
          name: `Sản phẩm thử nghiệm nén gzip số ${i}`,
          price: 100000 + i,
          description:
            'Mô tả chi tiết sản phẩm thử nghiệm với nội dung dài để vượt qua ngưỡng nén 1KB của compression middleware. '.repeat(
              10,
            ),
          images: [{ url: `https://example.com/img-${i}.jpg`, public_id: `img_${i}` }],
          instock: true,
          stock: 50,
        });
      }

      const res = await request(app)
        .get('/api/products/get-all-products/')
        .set('Accept-Encoding', 'gzip');

      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    test('does NOT compress when client does NOT send Accept-Encoding: gzip', async () => {
      const res = await request(app)
        .get('/api/products/get-all-products/')
        .set('Accept-Encoding', 'identity');

      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
    });

    test('does NOT compress small responses (<1KB threshold)', async () => {
      const res = await request(app).get('/api/home/live').set('Accept-Encoding', 'gzip');

      expect(res.status).toBe(200);
      // Small payload { success: true, status: 'alive' } is ~35 bytes, below 1024 bytes
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body).toEqual({ success: true, status: 'alive' });
    });
  });

  describe('(c) Exclusion of Server-Sent Events (SSE) from Compression', () => {
    let server;
    let port;

    beforeAll((done) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        done();
      });
    });

    afterAll((done) => {
      server.close(done);
    });

    test('SSE endpoint (/stream) never compresses and sends initial chunks immediately', async () => {
      const ticket = issueSseTicket('admin-user-sse-test');
      const res = await fetch(
        `http://127.0.0.1:${port}/api/admin/notifications/stream?ticket=${ticket}`,
        {
          headers: {
            Accept: 'text/event-stream',
            'Accept-Encoding': 'gzip, deflate',
          },
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      // Must NOT be gzipped
      expect(res.headers.get('content-encoding')).toBeNull();

      // Read initial heartbeat / newline chunk immediately without buffering
      const reader = res.body.getReader();
      const { value, done: streamDone } = await reader.read();
      expect(streamDone).toBe(false);
      const text = new TextDecoder().decode(value);
      expect(text).toContain('\n');

      await reader.cancel();
    });
  });
});
