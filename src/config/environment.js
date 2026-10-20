// Runtime snapshot: no dotenv, network or connection side effects.
module.exports = require('./resolveEnvironment').resolveEnvironment(process.env);
