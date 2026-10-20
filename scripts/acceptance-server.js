// Isolated acceptance server. Never accepts a production URI or production keys.
const crypto = require('crypto');
const uri = process.env.ACCEPTANCE_MONGODB_URI || 'mongodb://127.0.0.1:27018/totmart_acceptance?replicaSet=rs0&directConnection=true';
if (!/^mongodb:\/\/127\.0\.0\.1:27018\/totmart_acceptance\?/.test(uri)) throw new Error('Acceptance requires the isolated local database on port 27018');
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: uri, PORT: '3001',
  FRONTEND_URL: 'http://localhost:3000', CORS_ORIGINS: 'http://localhost:3000', REDIS_URL: '',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
  SEPAY_API_KEY: 'acceptance-only-no-live-payment', SEPAY_BANK_ACCOUNT: '0123456789', SEPAY_BANK_NAME: 'TestBank' });
const mongoose = require('mongoose');
const { hashPassword } = require('../src/services/passwordService');
const app = require('../src/app');
const User = require('../src/models/User'), Brand = require('../src/models/Brand'), Product = require('../src/models/Product'), Category = require('../src/models/Category'), Box = require('../src/models/Box');
async function start() {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('Acceptance requires replica set');
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  const password = process.env.ACCEPTANCE_PASSWORD || 'TotMart-Test-2026!';
  const hash = await hashPassword(password, undefined, 10);
  const accounts = [['admin', 'admin'], ['merchant1', 'merchant'], ['merchant2', 'merchant'], ['customer', 'user']];
  const users = {};
  for (const [name, role] of accounts) {
    users[name] = await User.findOneAndUpdate({ $or: [{ email: name + '@totmart-test.example.com' }, { email: name + '@acceptance.local' }] }, { $set: { email: name + '@totmart-test.example.com' }, $setOnInsert: { name, password: hash, role, tokenVersion: 0, isActive: true,
      addresses: [{ fullName: 'Acceptance Customer', address: '123 Test', district: 'Test', city: 'Test', country: 'VN', phone: '0900000000' }] } }, { upsert: true, new: true, runValidators: true });
  }
  const category = await Category.findOneAndUpdate({ name: 'Acceptance category' }, { $setOnInsert: { name: 'Acceptance category' } }, { upsert: true, new: true });
  for (const name of ['merchant1', 'merchant2']) {
    const brand = await Brand.findOneAndUpdate({ name: name + ' brand' }, { $set: { slug: name + '-brand' }, $setOnInsert: { name: name + ' brand', ownerId: users[name]._id } }, { upsert: true, new: true });
    const product = await Product.findOneAndUpdate({ productId: 'acceptance-' + name }, { $set: { slug: 'acceptance-' + name }, $setOnInsert: { productId: 'acceptance-' + name, ownerId: users[name]._id, name: name + ' product', description: 'Acceptance fixture', price: 100000, brand: brand._id, category: category._id, stock: 100, instock: true } }, { upsert: true, new: true });
    if (!await Box.exists({ name: name + ' combo' })) await Box.create({ ownerId: users[name]._id, name: name + ' combo', descriptions: 'Acceptance combo', stock: 30, value: 200000, products: [{ productId: product._id, name: product.name, quantity: 2, price: product.price }], validFrom: new Date(Date.now() - 60000), validTo: new Date(Date.now() + 365 * 86400000) });
  }
  if (process.argv.includes('--seed-only')) { await mongoose.disconnect(); console.log('Acceptance fixtures ready'); return; }
  const server = app.listen(3001, '127.0.0.1', () => console.log('Acceptance API ready at http://localhost:3001. Accounts: admin/merchant1/merchant2/customer@totmart-test.example.com. Password set by ACCEPTANCE_PASSWORD or documented test default. External payments are not live.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => mongoose.disconnect().then(() => process.exit(0))));
}
start().catch(error => { console.error(error.message); mongoose.disconnect().finally(() => { process.exitCode = 1; }); });
