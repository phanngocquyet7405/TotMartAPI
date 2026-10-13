const {createClient}=require('redis');
const {randomUUID}=require('crypto');
const config=require('../src/config/redis');
const {RedisRateLimitStore}=require('../src/services/redisRateLimitStore');
const uri=process.env.TEST_REDIS_URL;
(uri ? describe : describe.skip)('real Redis primitives for multiple API instances',()=>{
  let a,b,subscriber,namespace,keys=[];
  beforeAll(async()=>{
    if (!/^redis:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/\d+)?$/.test(uri)) throw new Error('TEST_REDIS_URL must be a local isolated Redis');
    namespace='totmart:test:'+randomUUID();
    a=createClient({url:uri,socket:{connectTimeout:2000,reconnectStrategy:false}});
    b=a.duplicate();subscriber=a.duplicate();
    for(const client of [a,b,subscriber]) client.on('error',()=>{});
    await a.connect();await b.connect();await subscriber.connect();
    jest.spyOn(config,'namespace').mockReturnValue(namespace);
  });
  afterAll(async()=>{
    if(a?.isReady && keys.length)await a.del(keys);
    jest.restoreAllMocks();for(const client of [subscriber,b,a])if(client?.isOpen)client.destroy();
  });
  test('two instances share auth quota and preserve separate refresh policy',async()=>{
    const get=jest.spyOn(config,'getClient'),authA=new RedisRateLimitStore('auth'),authB=new RedisRateLimitStore('auth'),refresh=new RedisRateLimitStore('refresh');
    for(const store of [authA,authB])store.init({windowMs:900000});refresh.init({windowMs:60000});
    keys.push(namespace+':limit:auth:ip',namespace+':limit:refresh:ip');
    for(let i=1;i<=11;i++){get.mockReturnValue(i%2?a:b);expect((await (i%2?authA:authB).increment('ip')).totalHits).toBe(i);}
    get.mockReturnValue(b);expect((await refresh.increment('ip')).totalHits).toBe(1);
    expect(await a.pTTL(keys[0])).toBeGreaterThan(0);get.mockRestore();
  });
  test('ticket GETDEL consumes once across clients',async()=>{
    const key=namespace+':ticket:one';keys.push(key);await a.set(key,'ticket',{EX:30});
    const values=await Promise.all([a.getDel(key),b.getDel(key)]);
    expect(values.filter(Boolean)).toEqual(['ticket']);expect(await a.exists(key)).toBe(0);
  });
  test('revocation publication reaches a separate subscriber',async()=>{
    let complete;const received=new Promise(resolve=>{complete=resolve;});const channel=namespace+':security';
    await subscriber.subscribe(channel,message=>complete(JSON.parse(message)));
    const event={userId:'test-user',tokenVersion:2};await a.publish(channel,JSON.stringify(event));
    let timeout;try{expect(await Promise.race([received,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Pub/Sub timeout')),3000);})])).toEqual(event);}
    finally{clearTimeout(timeout);await subscriber.unsubscribe(channel);}
  });
});
