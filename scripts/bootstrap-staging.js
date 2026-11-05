require('dotenv').config();
const mongoose=require('mongoose');
const {hashPassword}=require('../src/services/passwordService');
const {findForAuthentication}=require('../src/services/userIdentityService');
const User=require('../src/models/User');
function settings(env) {
  if(env.APP_ENV!=='staging')throw new Error('APP_ENV must be staging');
  if(!env.MONGODB_URI || new URL(env.MONGODB_URI).pathname!=='/totmart_staging')throw new Error('Bootstrap only permits database totmart_staging');
  const accounts = ['ADMIN','MERCHANT','CUSTOMER'].map(kind=>{
    const email=env[`STAGING_${kind}_EMAIL`]?.trim().toLowerCase(),password=env[`STAGING_${kind}_PASSWORD`];
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<16)throw new Error(`Set STAGING_${kind}_EMAIL and a password >=16 characters`);
    return {email,password,name:`TotMart Staging ${kind}`,role:kind==='ADMIN'?'admin':kind==='MERCHANT'?'merchant':'user'};
  });
  if(new Set(accounts.map(a=>a.email)).size!==3)throw new Error('Use three distinct staging emails');
  return accounts;
}
async function run() {
  const users=settings(process.env);
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
  try {
    await User.createIndexes();
    for(const input of users) {
      const existing=await findForAuthentication(User,input.email);
      if(existing){if(existing.role!==input.role || !existing.isActive)throw new Error('Existing staging account needs explicit review; no role/password changed');continue;}
      await User.create({...input,password:await hashPassword(input.password,undefined,12)});
    }
    console.log('Staging accounts ready. No existing passwords changed. Create catalog/address fixtures through the staging UI.');
  } finally {await mongoose.disconnect();}
}
module.exports={settings};
if(require.main===module)run().catch(()=>{console.error('Bootstrap refused or failed. Check staging DB name, account settings and connectivity; no secrets logged.');process.exitCode=1;});
