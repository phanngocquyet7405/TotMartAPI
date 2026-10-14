// Preview by default. Apply only after reviewing the report and backing up MongoDB.
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const Box = require('../src/models/Box');
const Template = require('../src/models/SubscriptionTemplate');
const Brand = require('../src/models/Brand');
const User = require('../src/models/User');
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const apply = process.argv.includes('--apply');
  const report = { mode: apply ? 'apply' : 'preview', products: 0, combos: 0, templates: 0, unresolved: [] };
  const owners = new Map();
  const merchants = new Set((await User.find({ role: 'merchant' }).select('_id')).map(u => String(u._id)));
  const brands = new Map((await Brand.find().select('_id ownerId')).map(b => [String(b._id), String(b.ownerId)]));
  for (const p of await Product.find().select('_id ownerId brand')) {
    const owner = p.ownerId ? String(p.ownerId) : brands.get(String(p.brand));
    if (!merchants.has(owner)) { report.unresolved.push({ kind: 'product', id: String(p._id) }); continue; }
    owners.set(String(p._id), owner);
    if (!p.ownerId) { report.products++; if (apply) await Product.collection.updateOne({ _id: p._id, ownerId: { $exists: false } }, { $set: { ownerId: new mongoose.Types.ObjectId(owner) } }); }
  }
  const boxOwners = new Map();
  for (const b of await Box.find().select('_id ownerId products')) {
    const candidates = new Set(b.products.map(p => owners.get(String(p.productId))));
    const owner = b.ownerId ? String(b.ownerId) : candidates.size === 1 ? [...candidates][0] : undefined;
    if (!merchants.has(owner) || [...candidates].some(id => id !== owner)) { report.unresolved.push({ kind: 'combo', id: String(b._id), reason: 'Mixed or unresolved ownership; admin must review' }); continue; }
    boxOwners.set(String(b._id), owner);
    if (!b.ownerId) { report.combos++; if (apply) await Box.collection.updateOne({ _id: b._id, ownerId: { $exists: false } }, { $set: { ownerId: new mongoose.Types.ObjectId(owner) } }); }
  }
  for (const t of await Template.find().select('_id ownerId boxId gift')) {
    const owner = boxOwners.get(String(t.boxId));
    if (!owner || t.gift.some(g => boxOwners.get(String(g.boxId)) !== owner) || t.ownerId && String(t.ownerId) !== owner) { report.unresolved.push({ kind: 'template', id: String(t._id) }); continue; }
    if (!t.ownerId) { report.templates++; if (apply) await Template.collection.updateOne({ _id: t._id, ownerId: { $exists: false } }, { $set: { ownerId: new mongoose.Types.ObjectId(owner) } }); }
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
