const request=require('supertest'), jwt=require('jsonwebtoken'), app=require('../src/app');
const {connect,clearDatabase,closeDatabase}=require('./helpers/db');
const {createUser}=require('./helpers/factories'), Session=require('../src/models/AuthSession');
beforeAll(connect);afterEach(clearDatabase);afterAll(closeDatabase);
test('cookie login persists profile, writes require CSRF header, logout revokes the session',async()=>{
  const {user,plainPassword}=await createUser(), agent=request.agent(app);
  const login=await agent.post('/api/home/login').send({email:user.email,password:plainPassword,rememberMe:true});
  expect(login.status).toBe(200); expect(login.headers['set-cookie'].every(c=>c.includes('HttpOnly'))).toBe(true); expect(login.headers['set-cookie'].some(c=>c.includes('Max-Age=2592000'))).toBe(true);
  expect(login.body.refreshToken).toBeUndefined(); const decoded=jwt.decode(login.body.token);expect(decoded.sid).toBeTruthy();
  expect((await agent.get('/api/users/me')).status).toBe(200);
  expect((await agent.post('/api/home/logout')).status).toBe(403);
  expect((await agent.post('/api/home/logout').set('X-TotMart-Request','1')).status).toBe(200);
  expect(await Session.countDocuments()).toBe(0);
  expect((await request(app).get('/api/users/me').set('Authorization',`Bearer ${login.body.token}`)).status).toBe(401);
});
test('refresh rotates opaque tokens and rejects replay of the previous cookie',async()=>{
  const {user,plainPassword}=await createUser();
  const login=await request(app).post('/api/home/login').send({email:user.email,password:plainPassword});
  const original=login.headers['set-cookie'].find(c=>c.startsWith('refreshToken=')).split(';')[0];
  const refreshed=await request(app).post('/api/home/refresh').set('Cookie',original).set('X-TotMart-Request','1');
  expect(refreshed.status).toBe(200); expect(refreshed.headers['set-cookie'].find(c=>c.startsWith('refreshToken=')).split(';')[0]).not.toBe(original);
  expect((await request(app).post('/api/home/refresh').set('Cookie',original).set('X-TotMart-Request','1')).status).toBe(401);
});
