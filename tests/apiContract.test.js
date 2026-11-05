const Ajv = require('ajv');
const request = require('supertest');
const app = require('../src/app');
const spec = require('../docs/api.openapi.json');
const validateError = new Ajv({ strict: false }).compile(spec.components.schemas.Error);
test('OpenAPI and synthetic request/response examples validate, including runtime Joi requests', async () => {
  expect((await require('../scripts/validate-api').validate()).operations).toBe(11);
});
test('documented unauthenticated/CSRF errors conform on actual app middleware', async () => {
  for (const response of [
    await request(app).post('/api/home/logout'),
    await request(app).post('/api/home/refresh').set('Cookie', 'refreshToken=fixture-invalid'),
  ]) {
    expect([401, 403]).toContain(response.status);
    expect(validateError(response.body)).toBe(true);
  }
});
