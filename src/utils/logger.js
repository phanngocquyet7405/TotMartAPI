const pino = require('pino');
const config = require('../config/environment');

const usePrettyTransport = config.nodeEnv === 'development';
const protectedErrors = ['production', 'staging'].includes(config.nodeEnv);
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
  'MongooseError',
  'ValidationError',
  'VersionError',
  'CastError',
  'AxiosError',
  'ReplyError',
  'SocketClosedUnexpectedlyError',
  'ClientClosedError',
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

const logger = pino({
  serializers: {
    err: (error) =>
      protectedErrors
        ? {
            type: errorTypes.has(error?.name) ? error.name : 'Error',
            code: safeErrorCode(error?.code),
            message: 'See request ID and audit records for investigation',
          }
        : pino.stdSerializers.err(error),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.query.token',
      'req.query.ticket',
      'req.headers.cookie',
      "res.headers['set-cookie']",
      'password',
      'token',
      'refreshToken',
      'email',
      'phone',
      'shippingAddress',
    ],
    censor: '[REDACTED]',
  },
  level: config.logLevel,
  transport: usePrettyTransport
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

module.exports = logger;
