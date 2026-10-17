// Read-only by default. Never infer ownership from names, email or the admin who edited a record.
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const Brand = require('../src/models/Brand');
const Box = require('../src/models/Box');
const Template = require('../src/models/SubscriptionTemplate');
const User = require('../src/models/User');
function unanimousOwner(parts, productOwners) {
  if (!parts.length) return null;
  const owners = parts.map(p => productOwners.get(String(p.productId)));
  return owners.every(Boolean) && new Set(owners).size === 1 ? owners[0] : null;
}
async function migrate({ apply = false } = {}) {
  const merchantIds = new Set((await User.find({ role: 'merchant', isActive: { $ne: false } }).select('_id').lean()).map(u => String(u._id)));
  const brands = new Map((await Brand.find().select('_id ownerId').lean()).map(b => [String(b._id), String(b.ownerId)]));
  const products = new Map(), boxes = new Map(), changes = [], unresolved = [];
  async function assign(Model, doc, ownerId) {
    changes.push({ collection: Model.collection.name, id: String(doc._id), ownerId });
    if (apply) {
      // Immutable ownerId is writable only here through an explicit administrative migration,
      // compare-and-set so a concurrent assignment is never overwritten.
      const result = await Model.collection.updateOne({ _id: doc._id, ownerId: null }, { $set: { ownerId: new mongoose.Types.ObjectId(ownerId) } });
      if (result.matchedCount !== 1) throw new Error('Ownership changed concurrently; rerun read-only review');
    }
  }
  for (const doc of await Product.find().select('_id ownerId brand').lean()) {
    const brandOwner = brands.get(String(doc.brand)), explicit = doc.ownerId && String(doc.ownerId);
    if (explicit && explicit !== brandOwner) { unresolved.push({ collection: 'products', id: String(doc._id), reason: 'ownerId conflicts with brand owner' }); continue; }
    const ownerId = explicit || brandOwner;
    if (!merchantIds.has(ownerId)) { unresolved.push({ collection: 'products', id: String(doc._id), reason: 'no verified active merchant on brand' }); continue; }
    products.set(String(doc._id), ownerId);
    if (!explicit) await assign(Product, doc, ownerId);
  }
  for (const doc of await Box.find().select('_id ownerId products').lean()) {
    const ownerId = unanimousOwner(doc.products, products), explicit = doc.ownerId && String(doc.ownerId);
    if (!ownerId || (explicit && explicit !== ownerId)) { unresolved.push({ collection: 'boxes', id: String(doc._id), reason: 'mixed, unknown or conflicting constituent ownership' }); continue; }
    boxes.set(String(doc._id), ownerId);
    if (!explicit) await assign(Box, doc, ownerId);
  }
  for (const doc of await Template.find().select('_id ownerId boxId').lean()) {
    const ownerId = boxes.get(String(doc.boxId)), explicit = doc.ownerId && String(doc.ownerId);
    if (!ownerId || (explicit && explicit !== ownerId)) { unresolved.push({ collection: 'subscriptiontemplates', id: String(doc._id), reason: 'source box ownership unresolved' }); continue; }
    if (!explicit) await assign(Template, doc, ownerId);
  }
  if (apply) await Promise.all([Product.createIndexes(), Box.createIndexes(), Template.createIndexes(), require('../src/models/Order').createIndexes()]);
  return { mode: apply ? 'apply_verified_metadata' : 'read_only', changes, unresolved,
    note: 'No order, price, stock, payment or historical subscription snapshot is changed. Unknown/mixed ownership is left unassigned.' };
}
async function main() {
  require('dotenv').config();
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI explicitly');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (apply && process.env.MIGRATION_CONFIRM_DATABASE !== mongoose.connection.name) throw new Error('For --apply set MIGRATION_CONFIRM_DATABASE to the exact reviewed database name');
    console.log(JSON.stringify(await migrate({ apply }), null, 2));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate, unanimousOwner };
