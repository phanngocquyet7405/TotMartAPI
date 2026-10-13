const {connect,clearDatabase,closeDatabase}=require('./helpers/db');
const {createUser}=require('./helpers/factories');
const Session=require('../src/models/AuthSession'),Outbox=require('../src/models/SecurityOutbox'),User=require('../src/models/User');
const {revoke}=require('../src/services/securityRevocationService');
beforeAll(connect);afterEach(clearDatabase);afterAll(closeDatabase);
async function fixture(){const {user}=await createUser();await Session.create({sessionId:'session-one',userId:user._id,tokenVersion:0,refreshHash:'hash',expiresAt:new Date(Date.now()+60000)});return user;}
test('lock + session deletion + outbox commit together',async()=>{
 const user=await fixture();await revoke({userId:user._id,set:{isActive:false},reason:'test_lock'});
 const updated=await User.findById(user._id);expect(updated.isActive).toBe(false);expect(updated.tokenVersion).toBe(1);
 expect(await Session.countDocuments()).toBe(0);expect(await Outbox.countDocuments({userId:user._id,state:'pending'})).toBe(1);
});
test('outbox failure rolls back user and session mutations',async()=>{
 const user=await fixture();const original=Outbox.create;
 Outbox.create=jest.fn().mockRejectedValue(new Error('outbox write failure'));
 try {await expect(revoke({userId:user._id,set:{isActive:false},reason:'test_lock'})).rejects.toThrow('outbox write failure');}finally{Outbox.create=original;}
 expect((await User.findById(user._id)).isActive).toBe(true);expect((await User.findById(user._id)).tokenVersion).toBe(0);expect(await Session.countDocuments()).toBe(1);
});
test('single-session logout retains other sessions and writes revocation event',async()=>{
 const user=await fixture();await Session.create({sessionId:'session-two',userId:user._id,tokenVersion:0,refreshHash:'hash-two',expiresAt:new Date(Date.now()+60000)});
 await revoke({userId:user._id,sessionId:'session-one',reason:'logout'});
 expect(await Session.countDocuments()).toBe(1);expect((await Session.findOne()).sessionId).toBe('session-two');expect((await User.findById(user._id)).tokenVersion).toBe(0);expect((await Outbox.findOne()).sessionId).toBe('session-one');
});
