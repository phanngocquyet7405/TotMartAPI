require('dotenv').config();
const mongoose=require('mongoose');
const {createClient}=require('redis');
async function run() {
  if(process.env.APP_ENV!=='staging' || process.env.NODE_ENV!=='production')throw new Error('Use APP_ENV=staging and NODE_ENV=production');
  if(!process.env.MONGODB_URI || new URL(process.env.MONGODB_URI).pathname!=='/totmart_staging')throw new Error('Expected isolated totmart_staging database');
  require('../src/config/environment'); // Same fail-fast configuration as deployed API.
  for(const name of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','BREVO_API_KEY','FROM_EMAIL'])if(!process.env[name])throw new Error('Missing staging integration config');
  const redis=createClient({url:process.env.REDIS_URL,socket:{connectTimeout:5000,reconnectStrategy:false}});
  redis.on('error',()=>{});let timer;
  try {
    await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000,autoIndex:false,autoCreate:false});
    const topology=await mongoose.connection.db.admin().command({hello:1});
    if(!topology.setName && topology.msg!=='isdbgrid')throw new Error('Transactions require replica set/sharded topology');
    await mongoose.connection.db.command({ping:1},{timeoutMS:3000});
    await Promise.race([
      (async()=>{
        await redis.connect();await redis.ping();
        const key=(process.env.REDIS_NAMESPACE||'totmart:staging')+':preflight:'+require('crypto').randomUUID();
        await redis.set(key,'single-use',{EX:30});
        if(await redis.getDel(key)!=='single-use' || await redis.getDel(key)!==null)throw new Error('GETDEL unsupported');
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Redis deadline')),10000);}),
    ]);
    console.log('PASS: production config, isolated staging DB, transaction topology, Mongo ping, Redis TLS/ping/GETDEL. No live payment/stream/backup verification implied.');
  } finally {clearTimeout(timer);if(redis.isOpen)redis.destroy();await mongoose.disconnect();}
}
run().catch(()=>{console.error('Staging preflight failed. Check environment names, DB topology/network, Redis TLS/ACL and credentials; values are not logged.');process.exitCode=1;});
