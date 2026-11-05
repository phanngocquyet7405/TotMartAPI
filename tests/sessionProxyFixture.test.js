const http = require('http');
const express = require('express');
const request = require('supertest');
const app = require('../src/app');
const sessions = require('../src/services/sessionService');
let upstream, proxy;
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));
beforeAll(async () => {
  const fixture = express();
  fixture.set('trust proxy', 'loopback');
  fixture.get('/fixture/cookie', (req, res) => {
    sessions.setCookies(res, 'fixture-access', 'fixture-refresh', true);
    res.json({ secure: req.secure });
  });
  fixture.use(app);
  upstream = http.createServer(fixture);
  await listen(upstream);
  proxy = http.createServer((req, res) => {
    // Terminating proxy overwrites client-supplied forwarded protocol.
    const forwarded = http.request(
      {
        hostname: '127.0.0.1',
        port: upstream.address().port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, 'x-forwarded-proto': 'https' },
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    forwarded.on('error', () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(forwarded);
  });
  await listen(proxy);
});
afterAll(async () => {
  await close(proxy);
  await close(upstream);
});
afterEach(() => {
  jest.restoreAllMocks();
});
test('local terminating proxy fixture: staging Secure cookies, forwarded protocol, CSRF and CORS', async () => {
  jest.spyOn(require('../src/config/sessionPolicy'), 'strictSessions').mockReturnValue(true);
  const client = request(`http://127.0.0.1:${proxy.address().port}`);
  const response = await client.get('/fixture/cookie').set('X-Forwarded-Proto', 'http');
  expect(response.body.secure).toBe(true);
  expect(
    response.headers['set-cookie'].every((value) =>
      ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'].every((flag) => value.includes(flag)),
    ),
  ).toBe(true);
  const cookie = 'refreshToken=fixture-invalid';
  expect((await client.post('/api/home/refresh').set('Cookie', cookie)).status).toBe(403);
  const allowed = await client
    .post('/api/home/refresh')
    .set('Cookie', cookie)
    .set('X-TotMart-Request', '1');
  expect(allowed.status).toBe(401);
  expect(
    allowed.headers['set-cookie'].every(
      (value) => value.includes('Secure') && value.includes('Expires='),
    ),
  ).toBe(true);
  expect(
    (await client.get('/api/home/health').set('Origin', 'https://untrusted.invalid')).status,
  ).toBe(403);
  const origin = process.env.CORS_ORIGINS.split(',')[0];
  const preflight = await client
    .options('/api/home/refresh')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'X-TotMart-Request');
  expect(preflight.status).toBe(204);
  expect(preflight.headers['access-control-allow-origin']).toBe(origin);
  expect(preflight.headers['access-control-allow-credentials']).toBe('true');
});
