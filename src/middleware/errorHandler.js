const logger = require('../utils/logger');
const { redactUrl } = require('../utils/logRedaction');
const dependencies = new Set(['MongoDB', 'Redis', 'SePay', 'Cloudinary', 'email']);
const mongoAvailabilityNames = new Set([
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
]);
// node-redis availability subclasses inherit name="Error". Match their actual classes,
// never a generic Error, message substring, or application-defined Redis-like name.
const redisErrors = require('redis');
const redisAvailabilityClasses = [
  'ConnectionTimeoutError',
  'SocketTimeoutError',
  'ClientClosedError',
  'ClientOfflineError',
  'DisconnectsClientError',
  'SocketClosedUnexpectedlyError',
  'RootNodesUnavailableError',
].map((name) => redisErrors[name]);
module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = Number(err.statusCode || err.status || 500),
    message = err.message || 'Internal Server Error';
  const details = {};
  if (typeof err.code === 'string' && /^(ATTEMPT_|ADDRESS_|IDEMPOTENCY_)/.test(err.code))
    details.code = err.code;
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  }
  if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }
  if (err.code === 'INVALID_DELIVERY_ADDRESS') {
    status = 422;
    details.code = err.code;
    details.fields = err.fields;
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation Error';
    details.errors = Object.values(err.errors).map((e) => e.message);
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate field value entered';
  } else if (err.name === 'VersionError') {
    status = 409;
    message = 'Dữ liệu vừa được thay đổi. Vui lòng tải lại.';
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'ID không hợp lệ';
  } else if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) {
    status = 401;
    message = 'Invalid or expired token';
  } else if (err.name === 'MulterError' || /^Chỉ chấp nhận file ảnh/.test(message)) status = 400;
  else if (
    mongoAvailabilityNames.has(err.name) ||
    redisAvailabilityClasses.some((ErrorClass) => err instanceof ErrorClass)
  ) {
    status = 503;
    message = mongoAvailabilityNames.has(err.name)
      ? 'Database temporarily unavailable'
      : 'Shared security store unavailable';
  }
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  const meta = { requestId: req.id, path: redactUrl(req.originalUrl), method: req.method, status };
  if (status >= 500)
    logger.error(
      {
        ...meta,
        event: 'request_failed',
        dependency: dependencies.has(err.dependency) ? err.dependency : undefined,
        err,
      },
      'Request failed',
    );
  else logger.warn(meta, message);
  if (
    status >= 500 &&
    ['production', 'staging'].includes(require('../config/environment').nodeEnv)
  ) {
    message = 'Lỗi hệ thống. Vui lòng thử lại.';
    delete details.code;
  }
  res.status(status).json({ success: false, status, message, ...details, requestId: req.id });
};
