jest.mock('../src/config/environment', () => {
  const actual = jest.requireActual('../src/config/environment');
  return { ...actual, sepay: { ...actual.sepay } };
});
const request = require('supertest');
const app = require('../src/app');

describe('Security hardening', () => {
  describe('Helmet security headers', () => {
    test('adds standard security headers and removes X-Powered-By', async () => {
      const res = await request(app).get('/api/home/live');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('CORS allowlist', () => {
    test('allows a request with no Origin header (server-to-server / webhook)', async () => {
      const res = await request(app).get('/api/home/live');
      expect(res.status).toBe(200);
    });

    test('rejects a request from an origin not in CORS_ORIGINS', async () => {
      const res = await request(app)
        .get('/api/home/live')
        .set('Origin', 'https://evil-site.example');
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('allows a request from an origin in CORS_ORIGINS', async () => {
      const res = await request(app)
        .get('/api/home/live')
        .set('Origin', process.env.CORS_ORIGINS.split(',')[0]);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        process.env.CORS_ORIGINS.split(',')[0],
      );
    });
  });

  describe('Auth guard on protected routes', () => {
    test('checkout without a token is rejected before touching the database', async () => {
      const res = await request(app).post('/api/checkout/check-out').send({
        addressId: '507f1f77bcf86cd799439011',
        paymentMethod: 'cod',
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('admin-only routes reject a request with no token', async () => {
      const res = await request(app).get('/api/users/get-all-users');
      expect(res.status).toBe(401);
    });
  });

  describe('SePay webhook API-key auth (isolated, no database)', () => {
    const express = require('express');
    const sepayAuth = require('../src/middleware/sepayAuth');
    let webhookApp, handler, previousKey;
    beforeEach(() => {
      previousKey = require('../src/config/environment').sepay.apiKey;
      require('../src/config/environment').sepay.apiKey = 'isolated-test-key';
      webhookApp = express();
      webhookApp.use(express.json());
      handler = jest.fn((req, res) => res.sendStatus(204));
      webhookApp.post('/api/checkout/sepay-webhook', sepayAuth.verifyApiKey, handler);
    });
    afterEach(() => {
      if (previousKey === undefined) delete require('../src/config/environment').sepay.apiKey;
      else require('../src/config/environment').sepay.apiKey = previousKey;
    });
    test.each([undefined, 'Apikey wrong-key', 'Apikey x'])(
      'rejects header %j before handler',
      async (header) => {
        const call = request(webhookApp).post('/api/checkout/sepay-webhook');
        if (header !== undefined) call.set('Authorization', header);
        const res = await call.send({ id: 1 });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ success: false, message: 'Unauthorized' });
        expect(handler).not.toHaveBeenCalled();
      },
    );
    test.each(['Apikey', 'Bearer'])('accepts supported %s format exactly once', async (scheme) => {
      const res = await request(webhookApp)
        .post('/api/checkout/sepay-webhook')
        .set('Authorization', `${scheme} isolated-test-key`)
        .send({ id: 1 });
      expect(res.status).toBe(204);
      expect(handler).toHaveBeenCalledTimes(1);
    });
    test('missing server key returns 500 and never enters handler', async () => {
      delete require('../src/config/environment').sepay.apiKey;
      const res = await request(webhookApp)
        .post('/api/checkout/sepay-webhook')
        .set('Authorization', 'Apikey isolated-test-key')
        .send({ id: 1 });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        message: 'Webhook is not configured',
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });
  describe('Unknown routes', () => {
    test('returns a 404 JSON payload for an unregistered route', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
