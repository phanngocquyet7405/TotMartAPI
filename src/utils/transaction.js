const mongoose = require('mongoose');
const config = require('../config/environment');

/**
 * Build transaction options with explicit timeouts from environment configuration.
 *
 * @param {Object} [options]
 * @returns {Object}
 */
function getTransactionOptions(options = {}) {
  const mongodb = config.mongodb || {};
  return {
    maxCommitTimeMS: options.maxCommitTimeMS ?? mongodb.maxCommitTimeMS ?? 10000,
    timeoutMS: options.timeoutMS ?? mongodb.transactionTimeoutMS ?? 15000,
    ...(options.readPreference && { readPreference: options.readPreference }),
    ...(options.readConcern && { readConcern: options.readConcern }),
    ...(options.writeConcern && { writeConcern: options.writeConcern }),
  };
}

/**
 * Execute an async callback inside a MongoDB transaction with bounded timeout and maxCommitTimeMS.
 *
 * @param {Function} fn - async (session) => any
 * @param {Object} [options]
 * @param {mongoose.ClientSession} [options.session] - optional existing session to run with
 * @param {number} [options.maxCommitTimeMS]
 * @param {number} [options.timeoutMS]
 * @param {mongoose.Connection} [options.connection]
 * @returns {Promise<any>}
 */
async function withTransaction(fn, options = {}) {
  const txnOptions = getTransactionOptions(options);

  if (options.session) {
    return options.session.withTransaction(() => fn(options.session), txnOptions);
  }

  const session = await (options.connection
    ? options.connection.startSession(options.sessionOptions)
    : mongoose.startSession(options.sessionOptions));
  try {
    return await session.withTransaction(() => fn(session), txnOptions);
  } finally {
    try {
      const end = session?.endSession?.();
      if (end && typeof end.catch === 'function') {
        await end.catch(() => {});
      }
    } catch {
      // Ignore endSession cleanup errors
    }
  }
}

let patched = false;
function patchMongooseTransaction() {
  if (patched) return;
  patched = true;
  const originalTransaction = mongoose.Connection?.prototype?.transaction;
  if (typeof originalTransaction === 'function') {
    mongoose.Connection.prototype.transaction = function (fn, options) {
      const mergedOptions = getTransactionOptions(options);
      return originalTransaction.call(this, fn, mergedOptions);
    };
  }

  const ClientSession = mongoose.mongo?.ClientSession;
  if (ClientSession && typeof ClientSession.prototype?.withTransaction === 'function') {
    const originalWithTransaction = ClientSession.prototype.withTransaction;
    ClientSession.prototype.withTransaction = function (fn, options) {
      const mergedOptions = getTransactionOptions(options);
      return originalWithTransaction.call(this, fn, mergedOptions);
    };
  }
}

// Automatically patch connection.transaction on load
patchMongooseTransaction();

module.exports = {
  withTransaction,
  runTransaction: withTransaction,
  getTransactionOptions,
  patchMongooseTransaction,
};
