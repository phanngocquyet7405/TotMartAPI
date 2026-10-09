// Default is read-only. --apply creates missing checkout records after review.
require('dotenv').config();
const mongoose=require('mongoose'), crypto=require('crypto');
mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
const Order=require('../src/models/Order'), Checkout=require('../src/models/Checkout'), Cart=require('../src/models/Cart'), Subscription=require('../src/models/UserSubscription');
async function run(){
  const apply=process.argv.includes('--apply');
  if(!process.env.MONGODB_URI)throw new Error('Set MONGODB_URI explicitly');
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
  const duplicateCarts=await Cart.aggregate([{$group:{_id:{userId:'$userId',isSubscribeCart:'$isSubscribeCart'},count:{$sum:1},ids:{$push:'$_id'}}},{$match:{count:{$gt:1}}}]);
  const legacySubscriptions=await Subscription.find({status:'active',paymentStatus:{$ne:'paid'}}).select('_id paymentCode totalDeliveries completeDeliveries remainDeliveries').lean();
  const groups=new Map();
  for await(const order of Order.find({paymentCode:{$exists:true,$ne:''}}).lean().cursor()){if(!groups.has(order.paymentCode))groups.set(order.paymentCode,[]);groups.get(order.paymentCode).push(order);}
  const candidates=[],needsReview=[];
  for(const [code,orders] of groups){
    if(await Checkout.exists({paymentCode:code}))continue;
    const users=new Set(orders.map(o=>String(o.userId))),methods=new Set(orders.map(o=>o.paymentMethod)),coupons=new Set(orders.map(o=>o.couponCode||''));
    const allPaid=orders.every(o=>o.paymentStatus==='paid'),allCancelled=orders.every(o=>o.status==='cancelled');
    if(users.size!==1||methods.size!==1||coupons.size!==1||(!allPaid&&orders.some(o=>o.paymentStatus==='paid'))){needsReview.push({paymentCode:code,reason:'mixed ownership/payment/coupon state'});continue;}
    const totalAmount=orders.reduce((s,o)=>s+o.totalAmount,0);if(!Number.isSafeInteger(totalAmount)||totalAmount<0){needsReview.push({paymentCode:code,reason:'invalid amount'});continue;}
    const first=orders[0],createdAt=new Date(Math.min(...orders.map(o=>new Date(o.createdAt).getTime())));
    const expiresAt=new Date(createdAt.getTime()+(Number(process.env.ORDER_EXPIRY_HOURS)||24)*3600000);
    candidates.push({userId:first.userId,paymentCode:code,requestKey:'legacy-'+crypto.createHash('sha256').update(code).digest('hex'),requestHash:crypto.createHash('sha256').update('legacy:'+code).digest('hex'),orderIds:orders.map(o=>o._id),totalAmount,paymentMethod:first.paymentMethod,state:allCancelled?'cancelled':allPaid?'paid':'pending',expiresAt,couponCode:first.couponCode,couponReleased:allCancelled,paidReferenceCode:orders.find(o=>o.paidReferenceCode)?.paidReferenceCode,overpaidAmount:orders.reduce((s,o)=>s+(o.overpaidAmount||0),0),result:{orderId:String(first._id),orderCode:code,totalAmount}});
  }
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',candidateCount:candidates.length,duplicateCarts,legacySubscriptions,needsReview},null,2));
  if(apply){
    if(duplicateCarts.length||needsReview.length)throw new Error('Resolve duplicate carts and inconsistent orders before applying');
    await Checkout.createIndexes();
    for(const candidate of candidates)await Checkout.updateOne({paymentCode:candidate.paymentCode},{$setOnInsert:candidate},{upsert:true});
    await Cart.createIndexes();
    console.log('Checkout migration applied. Legacy subscriptions and coupon counts were NOT modified.');
  }
}
run().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>mongoose.disconnect());
