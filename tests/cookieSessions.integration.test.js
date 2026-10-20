const request = require('supertest'),
  jwt = require('jsonwebtoken'),
  app = require('../src/app');
const { connect, clearDatabase, closeDatabase } = require('./helpers/db');
const { createUser } = require('./helpers/factories'),
  Session = require('../src/models/AuthSession');
const { assertResponse } = require('./helpers/apiContract');
beforeAll(connect);
afterEach(clearDatabase);
afterAll(closeDatabase);
test('cookie login persists profile, writes require CSRF header, logout revokes the session', async () => {
  const { user, plainPassword } = await createUser(),
    agent = request.agent(app);
  const login = await agent
    .post('/api/home/login')
    .send({ email: user.email, password: plainPassword, rememberMe: true });
  await assertResponse('/home/login', 'post', login);
  expect(login.status).toBe(200);
  expect(login.headers['set-cookie'].every((c) => c.includes('HttpOnly'))).toBe(true);
  expect(login.headers['set-cookie'].some((c) => c.includes('Max-Age=2592000'))).toBe(true);
  expect(login.body.refreshToken).toBeUndefined();
  const decoded = jwt.decode(login.body.token);
  expect(decoded.sid).toBeTruthy();
  expect((await agent.get('/api/users/me')).status).toBe(200);
  expect((await agent.post('/api/home/logout')).status).toBe(403);
  expect((await agent.post('/api/home/logout').set('X-TotMart-Request', '1')).status).toBe(200);
  expect(await Session.countDocuments()).toBe(0);
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${login.body.token}`))
      .status,
  ).toBe(401);
});
test('refresh rotates opaque tokens and permits bounded retry of the previous cookie', async () => {
  const { user, plainPassword } = await createUser();
  const login = await request(app)
    .post('/api/home/login')
    .send({ email: user.email, password: plainPassword });
  await assertResponse('/home/login', 'post', login);
  const original = login.headers['set-cookie']
    .find((c) => c.startsWith('refreshToken='))
    .split(';')[0];
  const refreshed = await request(app)
    .post('/api/home/refresh')
    .set('Cookie', original)
    .set('X-TotMart-Request', '1');
  await assertResponse('/home/refresh', 'post', refreshed);
  const successor = refreshed.headers['set-cookie']
    .find((c) => c.startsWith('refreshToken='))
    .split(';')[0];
  expect(refreshed.status).toBe(200);
  expect(successor !== original).toBe(true);
  for (let retry = 0; retry < 2; retry++) {
    const response = await request(app)
      .post('/api/home/refresh')
      .set('Cookie', original)
      .set('X-TotMart-Request', '1');
    expect(response.status).toBe(200);
    await assertResponse('/home/refresh', 'post', response);
    expect(
      response.headers['set-cookie'].find((c) => c.startsWith('refreshToken=')).split(';')[0] ===
        successor,
    ).toBe(true);
  }
  const refused = await request(app)
    .post('/api/home/refresh')
    .set('Cookie', original)
    .set('X-TotMart-Request', '1');
  expect(refused.status).toBe(401);
  await assertResponse('/home/refresh', 'post', refused);
  expect(Boolean((await Session.findOne()).revokedAt)).toBe(true);
  expect(
    (await request(app).get('/api/users/me').set('Authorization', `Bearer ${refreshed.body.token}`))
      .status,
  ).toBe(401);
});
test('login rejects invalid credentials with the documented auth error', async () => {
  const response = await request(app)
    .post('/api/home/login')
    .send({ email: 'missing@example.com', password: 'FixturePassword123!' });
  expect(response.status).toBe(401);
  await assertResponse('/home/login', 'post', response);
  expect(await Session.countDocuments()).toBe(0);
});
