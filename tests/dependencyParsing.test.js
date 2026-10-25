const express = require('express');
const request = require('supertest');
const { gzipSync } = require('node:zlib');
const upload = require('../src/middleware/uploadMiddleware');
const brandLogoUpload = require('../src/middleware/brandLogoUpload');

const app = express();
// Match the application's explicit limits without booting infrastructure.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.post('/body', (req, res) => res.json(req.body));
app.post('/product', upload.array('images', 10), (req, res) =>
  res.json({ sizes: req.files.map((file) => file.size) }),
);
app.post('/box', upload.boxUpload.array('images', 10), (req, res) =>
  res.json({ sizes: req.files.map((file) => file.size) }),
);
app.post('/brand', brandLogoUpload, (req, res) => res.json({ size: req.file.size }));
app.use((error, req, res, next) =>
  res.status(error.statusCode || error.status || 400).json({ code: error.code || error.type }),
);

const image = (size) => {
  const bytes = Buffer.alloc(size);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  return bytes;
};
const attach = (endpoint, field, size) =>
  request(app)
    .post(endpoint)
    .attach(field, image(size), { filename: 'fixture.png', contentType: 'image/png' });

test.each([
  ['/product', 'images', 2 * 1024 * 1024],
  ['/box', 'images', 5 * 1024 * 1024],
  ['/brand', 'logo', 2 * 1024 * 1024],
])('%s preserves its exact upload size boundary', async (endpoint, field, limit) => {
  const accepted = await attach(endpoint, field, limit);
  expect(accepted.status).toBe(200);
  expect(accepted.body).toEqual(field === 'logo' ? { size: limit } : { sizes: [limit] });
  const rejected = await attach(endpoint, field, limit + 1);
  expect(rejected.status).toBe(400);
  expect(rejected.body.code).toBe('LIMIT_FILE_SIZE');
});

test('product upload preserves the ten-file boundary', async () => {
  let valid = request(app).post('/product');
  let invalid = request(app).post('/product');
  for (let count = 0; count < 11; count++) {
    invalid = invalid.attach('images', image(8), 'fixture.png');
    if (count < 10) valid = valid.attach('images', image(8), 'fixture.png');
  }
  expect((await valid).status).toBe(200);
  expect((await invalid).body.code).toBe('LIMIT_FILE_COUNT');
});

test('brand preserves its text field-size boundary', async () => {
  expect((await request(app).post('/brand').field('name', 'x'.repeat(4097))).body.code).toBe(
    'LIMIT_FIELD_VALUE',
  );
});

test.each(['application/json', 'application/x-www-form-urlencoded'])(
  '%s keeps the 100KB body boundary',
  async (contentType) => {
    const limit = 100 * 1024;
    const body =
      contentType === 'application/json'
        ? JSON.stringify({ text: 'x'.repeat(limit - 11) })
        : 'text=' + 'x'.repeat(limit - 5);
    expect(Buffer.byteLength(body)).toBe(limit);
    expect(
      (await request(app).post('/body').set('Content-Type', contentType).send(body)).status,
    ).toBe(200);
    const larger =
      contentType === 'application/json' ? JSON.stringify({ text: 'x'.repeat(limit) }) : body + 'x';
    const response = await request(app).post('/body').set('Content-Type', contentType).send(larger);
    expect(response.status).toBe(413);
    expect(response.body.code).toBe('entity.too.large');
  },
);

test('JSON keeps compressed-body support and checks the decoded size', async () => {
  const send = (body) =>
    request(app)
      .post('/body')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .serialize((bytes) => bytes)
      .send(gzipSync(Buffer.from(JSON.stringify(body))));
  const accepted = await send({ text: 'fresh fruit' });
  expect(accepted.status).toBe(200);
  expect(accepted.body).toEqual({ text: 'fresh fruit' });
  expect((await send({ text: 'x'.repeat(100 * 1024) })).status).toBe(413);
});
