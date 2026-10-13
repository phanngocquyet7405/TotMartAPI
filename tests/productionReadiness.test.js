const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const health = require('../src/controllers/healthController');
afterEach(() => { jest.restoreAllMocks(); health.setStopping(false); });
test('liveness works without DB, readiness fails closed',async()=>{
  expect((await request(app).get('/api/home/live')).status).toBe(200);
  const result=await request(app).get('/api/home/health');
  expect(result.status).toBe(503);expect(result.body.status).toBe('not_ready');expect(result.headers['x-request-id']).toBeTruthy();
});
test('readiness pings DB; ping failure and shutdown return 503',async()=>{
  const old=mongoose.connection.db;
  const oldReady=mongoose.connection._readyState;
  mongoose.connection._readyState=1;
  const command=jest.fn().mockResolvedValue({ok:1});mongoose.connection.db={command};
  try {
    expect((await request(app).get('/api/home/health')).status).toBe(200);expect(command).toHaveBeenCalledWith({ping:1},{timeoutMS:2000});
    command.mockRejectedValue(new Error('DB password must never leak'));expect((await request(app).get('/api/home/health')).status).toBe(503);
    health.setStopping(true);command.mockClear();expect((await request(app).get('/api/home/health')).status).toBe(503);expect(command).not.toHaveBeenCalled();
  } finally {mongoose.connection.db=old;mongoose.connection._readyState=oldReady;}
});
