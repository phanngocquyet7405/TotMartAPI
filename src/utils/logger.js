const pino = require('pino');
const config = require('../config/environment');

const usePrettyTransport = config.nodeEnv === 'development';
const protectedErrors = ['production', 'staging'].includes(config.nodeEnv);
const safeErrorSerializer = require('./safeErrorSerializer');

const logger = pino({
  serializers: {
    err: (error) =>
      protectedErrors
        ? {
            ...safeErrorSerializer(error),
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
