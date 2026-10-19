// Standalone local drill: creates and removes only its own container, never loads .env.
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const name = 'totmart-session-backup-' + randomUUID();
const docker = args => execFileSync('docker', args, { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
let created = false, client;
async function main() {
  docker(['run', '-d', '--name', name, '-p', '127.0.0.1::27017', 'mongo:7.0', 'mongod', '--replSet', 'rsdrill', '--bind_ip_all']); created = true;
  const port = docker(['port', name, '27017/tcp']).trim().split(':').pop();
  client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 2000 });
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await client.connect(); await client.db('admin').command({ ping: 1 }); ready = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(ready, 'Mongo startup deadline');
  await client.db('admin').command({ replSetInitiate: { _id: 'rsdrill', members: [{ _id: 0, host: 'localhost:27017' }] } });
  ready = false;
  for (let i = 0; i < 50; i++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) { ready = true; break; } await new Promise(r => setTimeout(r, 200)); }
  assert(ready, 'Primary deadline');
  const source = client.db('totmart_backup_source'), destination = client.db('totmart_backup_restored');
  const userId = new ObjectId(), orderId = new ObjectId(), checkoutId = new ObjectId(), eventId = new ObjectId();
  await source.collection('orders').insertOne({ _id: orderId, userId, paymentCode: 'DRILL', totalAmount: 100000, status: 'processing', paymentStatus: 'paid' });
  await source.collection('checkouts').insertOne({ _id: checkoutId, userId, requestKey: 'drill-reference-12345', orderIds: [orderId], paymentCode: 'DRILL', receivedAmount: 110000, totalAmount: 100000, state: 'paid', paymentLedgerVersion: 2 });
  await source.collection('paymentevents').insertOne({ _id: eventId, paymentCode: 'DRILL', referenceCode: 'DRILL-RECEIPT', transferAmount: 110000, state: 'processed' });
  await source.collection('paymentallocations').insertOne({ eventId, checkoutId, amount: 110000 });
  await source.collection('receiptrefunds').insertOne({ key: 'surplus-drill', checkoutId, amount: 10000, status: 'pending' });
  await source.collection('checkoutattempts').insertOne({ userId, kind: 'products', key: 'drill-reference-12345', state: 'created', result: { orderId } });
  await source.collection('checkouts').createIndex({ userId: 1, requestKey: 1 }, { unique: true });
  await source.collection('checkoutattempts').createIndex({ userId: 1, kind: 1, key: 1 }, { unique: true });
  await source.collection('paymentallocations').createIndex({ eventId: 1 }, { unique: true });
  // No writers run during this backup. Archive stays in the disposable container.
  docker(['exec', name, 'mongodump', '--uri=mongodb://localhost:27017/totmart_backup_source?replicaSet=rsdrill', '--archive=/tmp/drill.archive', '--gzip']);
  docker(['exec', name, 'mongorestore', '--uri=mongodb://localhost:27017/?replicaSet=rsdrill', '--archive=/tmp/drill.archive', '--gzip', '--nsFrom=totmart_backup_source.*', '--nsTo=totmart_backup_restored.*']);
  for (const { name: collection } of await source.listCollections().toArray()) {
    assert.equal(await source.collection(collection).countDocuments(), await destination.collection(collection).countDocuments());
    assert.deepEqual(await destination.collection(collection).indexes(), await source.collection(collection).indexes());
    assert.deepEqual(await destination.collection(collection).find().toArray(), await source.collection(collection).find().toArray());
  }
  const restored = await destination.collection('checkouts').findOne({ _id: checkoutId });
  assert.equal(await destination.collection('orders').countDocuments({ _id: { $in: restored.orderIds }, userId }), restored.orderIds.length);
  const sum = async collection => (await destination.collection(collection).aggregate([{ $group: { _id: null, sum: { $sum: '$amount' } } }]).toArray())[0].sum;
  assert.equal(await sum('paymentallocations'), restored.receivedAmount);
  assert.equal(restored.receivedAmount, restored.totalAmount + await sum('receiptrefunds'));
  console.log('PASS: real mongodump/mongorestore, 6 collections, counts/documents/indexes/relations/ledger conserved in a new database');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (client) await client.close(); if (created) docker(['rm', '-f', name]); });
