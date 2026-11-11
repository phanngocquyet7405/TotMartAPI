const { isServerReady } = require('../controllers/healthController');

function serviceAvailability(req, res, next) {
  // Liveness probe (/api/home/live) is always permitted so orchestrators/Render know the process is alive
  if (req.path === '/api/home/live') {
    return next();
  }

  // Before DB, ledger, indexes, topology and Redis are ready, block all transactions/routes
  if (!isServerReady()) {
    // Readiness probe (/api/home/health) delegates to healthController to return 503 not_ready
    if (req.path === '/api/home/health') {
      return next();
    }

    res.set('Retry-After', '5');
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
      success: false,
      message: 'Hệ thống đang khởi động, vui lòng thử lại sau giây lát',
      code: 'SERVER_STARTING',
    });
  }

  next();
}

module.exports = serviceAvailability;
