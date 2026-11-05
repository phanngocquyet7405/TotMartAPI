const redis = require('../config/redis');
const incrementScript = `local n=redis.call('INCR',KEYS[1]); if n==1 or redis.call('PTTL',KEYS[1])<0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}`;
class RedisRateLimitStore {
  constructor(policy) { this.prefix = `${redis.namespace()}:limit:${policy}:`; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  async increment(key) {
    let result;
    try { result = await redis.getClient().eval(incrementScript, { keys: [this.prefix + key], arguments: [String(this.windowMs)] }); }
    catch { throw Object.assign(new Error('Shared security store unavailable'), { statusCode: 503 }); }
    return { totalHits: Number(result[0]), resetTime: new Date(Date.now() + Math.max(0, Number(result[1]))) };
  }
  async decrement(key) { await redis.getClient().eval("if tonumber(redis.call('GET',KEYS[1]) or '0')>0 then return redis.call('DECR',KEYS[1]); end; return 0", { keys: [this.prefix + key], arguments: [] }); }
  async resetKey(key) { await redis.getClient().del(this.prefix + key); }
}
module.exports = { RedisRateLimitStore };
