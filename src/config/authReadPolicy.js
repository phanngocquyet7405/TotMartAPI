// Per-read CSOT at authentication/authorization boundaries; never a MongoClient default.
const AUTH_READ_TIMEOUT_MS = 5000;

module.exports = { AUTH_READ_TIMEOUT_MS };
