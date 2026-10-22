const errorTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AggregateError',
  'AbortError',
  'MongoError',
  'MongoServerError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoOperationTimeoutError',
  'MongoPoolClearedError',
  'PoolClearedOnNetworkError',
  'MongoPoolClosedError',
  'MongoWaitQueueTimeoutError',
  'MongoTopologyClosedError',
  'MongoServerClosedError',
  'MongoClientClosedError',
  'MongooseError',
  'ValidationError',
  'VersionError',
  'CastError',
  'AxiosError',
  'ReplyError',
  'SocketClosedUnexpectedlyError',
  'ClientClosedError',
  'ConnectionTimeoutError',
  'SocketTimeoutError',
  'ClientOfflineError',
  'DisconnectsClientError',
  'RootNodesUnavailableError',
]);
const errorCodes = new Set([
  ...Array.from(require('node:util').getSystemErrorMap().values(), ([name]) => name),
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'IDENTITY_MIGRATION_REQUIRED',
]);
function safeErrorCode(code) {
  if (code === undefined) return undefined;
  if (errorCodes.has(code) || (Number.isSafeInteger(code) && code >= -65536 && code <= 2147483647))
    return code;
  return 'UNCLASSIFIED';
}

module.exports = (error) => {
  const name = error?.name === 'Error' ? error?.constructor?.name : error?.name;
  return { type: errorTypes.has(name) ? name : 'Error', code: safeErrorCode(error?.code) };
};
