const express = require('express');
const request = require('supertest');
const { resolveEnvironment } = require('../src/config/resolveEnvironment');
const { validateProductionEnv } = require('../src/config/environmentChecks');
const { webhookFloodLimiter, webhookLimiter } = require('../src/middleware/rateLimiter');
const sepayAuth = require('../src/middleware/sepayAuth');

describe('Proxy and Rate Limit Hardening (Phase 2)', () => {
  describe('(a) Production boot requires explicit TRUST_PROXY', () => {
    const validProductionEnv = () => ({
      NODE_ENV: 'production',
      JWT_SECRET: '9f8e7d6c5b4a39281716aabbccddeeff00112233',
      JWT_REFRESH_SECRET: '1a2b3c4d5e6f70819283bbccddeeff9988776655',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/totmart',
      FRONTEND_URL: 'https://totmart.vn',
      CORS_ORIGINS: 'https://totmart.vn',
      SEPAY_API_KEY: 'valid-sepay-api-key',
      SEPAY_BANK_ACCOUNT: '1234567890',
      SEPAY_BANK_NAME: 'MBBank',
      REDIS_URL: 'rediss://default:secret@redis.example.com:6380',
      REDIS_NAMESPACE: 'totmart:production',
    });

    test('resolveEnvironment fails when TRUST_PROXY is missing in production', () => {
      const env = validProductionEnv();
      delete env.TRUST_PROXY;
      expect(() => resolveEnvironment(env)).toThrow(
        /Missing required environment variables:.*TRUST_PROXY/,
      );
    });

    test('resolveEnvironment fails when TRUST_PROXY is empty string in production', () => {
      const env = { ...validProductionEnv(), TRUST_PROXY: '' };
      expect(() => resolveEnvironment(env)).toThrow(/Invalid configuration: TRUST_PROXY/);
    });

    test('validateProductionEnv fails when TRUST_PROXY is missing or empty', () => {
      const env = validProductionEnv();
      delete env.TRUST_PROXY;
      const { errors } = validateProductionEnv(env);
      expect(errors).toContain('TRUST_PROXY phải được khai báo rõ ràng trong production');
    });

    test('TRUST_PROXY=0 warns unless TRUST_PROXY_CONFIRMED_DIRECT is set', () => {
      const env = { ...validProductionEnv(), TRUST_PROXY: '0' };
      const { errors, warnings } = validateProductionEnv(env);
      expect(errors).toEqual([]);
      expect(warnings.some((w) => w.includes('TRUST_PROXY=0'))).toBe(true);

      const confirmed = { ...env, TRUST_PROXY_CONFIRMED_DIRECT: 'true' };
      const resConfirmed = validateProductionEnv(confirmed);
      expect(resConfirmed.errors).toEqual([]);
      expect(resConfirmed.warnings).toEqual([]);
    });

    test('TRUST_PROXY=1 is accepted cleanly without errors or warnings', () => {
      const env = { ...validProductionEnv(), TRUST_PROXY: '1' };
      const res = validateProductionEnv(env);
      expect(res.errors).toEqual([]);
      expect(res.warnings).toEqual([]);
    });
  });

  describe('(b) Clients with different X-Forwarded-For are rate-limited independently when TRUST_PROXY=1', () => {
    function createProxyApp(trustProxySetting, maxRequests = 3) {
      const app = express();
      app.set('trust proxy', trustProxySetting);
      const rateLimit = require('express-rate-limit');
      const testLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: maxRequests,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Too many requests' },
      });
      app.get('/api/test-limit', testLimiter, (req, res) => {
        res.status(200).json({ success: true, ip: req.ip });
      });
      return app;
    }

    test('TRUST_PROXY=1 isolates quotas by client IP in X-Forwarded-For', async () => {
      const app = createProxyApp(1, 3);
      const clientA = '203.0.113.10';
      const clientB = '198.51.100.20';

      // Client A uses up quota (3 requests)
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/test-limit').set('X-Forwarded-For', clientA);
        expect(res.status).toBe(200);
        expect(res.body.ip).toBe(clientA);
      }

      // Client A 4th request is rate-limited (429)
      const resA4 = await request(app).get('/api/test-limit').set('X-Forwarded-For', clientA);
      expect(resA4.status).toBe(429);

      // Client B from a different IP is NOT blocked and gets 200
      const resB1 = await request(app).get('/api/test-limit').set('X-Forwarded-For', clientB);
      expect(resB1.status).toBe(200);
      expect(resB1.body.ip).toBe(clientB);
    });

    test('TRUST_PROXY=0 conflates client IPs, allowing one client to exhaust shared quota', async () => {
      const app = createProxyApp(0, 3);
      const clientA = '203.0.113.10';
      const clientB = '198.51.100.20';

      // 3 requests from client A
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/test-limit').set('X-Forwarded-For', clientA);
        expect(res.status).toBe(200);
      }

      // Client B is immediately blocked because trust proxy is 0 (both map to 127.0.0.1)
      const resB = await request(app).get('/api/test-limit').set('X-Forwarded-For', clientB);
      expect(resB.status).toBe(429);
    });
  });

  describe('(c) Two-tier webhook rate limiting: 70 invalid requests do not block valid requests', () => {
    let webhookApp, validApiKey;

    beforeAll(() => {
      validApiKey =
        require('../src/config/environment').sepay.apiKey ||
        process.env.SEPAY_API_KEY ||
        'test-sepay-key';

      webhookApp = express();
      webhookApp.set('trust proxy', 1);
      webhookApp.use(express.json());

      // Two-tier middleware chain matching checkOutRouter.js
      webhookApp.post(
        '/api/checkout/sepay-webhook',
        webhookFloodLimiter,
        sepayAuth.verifyApiKey,
        webhookLimiter,
        (req, res) => {
          res.status(200).json({ success: true, processed: true });
        },
      );
    });

    test('70 invalid webhook requests return 401 and do NOT exhaust the post-auth webhook quota', async () => {
      const clientIp = '198.51.100.99';

      // 70 invalid requests with bad API key
      for (let i = 0; i < 70; i++) {
        const res = await request(webhookApp)
          .post('/api/checkout/sepay-webhook')
          .set('X-Forwarded-For', clientIp)
          .set('Authorization', 'Apikey bad-or-forged-key')
          .send({ id: 1000 + i });
        expect(res.status).toBe(401);
      }

      // 71st request with VALID API key succeeds with 200, NOT 429
      const validRes = await request(webhookApp)
        .post('/api/checkout/sepay-webhook')
        .set('X-Forwarded-For', clientIp)
        .set('Authorization', `Apikey ${validApiKey}`)
        .send({ id: 9999 });

      expect(validRes.status).toBe(200);
      expect(validRes.body).toEqual({ success: true, processed: true });
    });
  });
});
