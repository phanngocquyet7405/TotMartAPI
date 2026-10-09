// Browser writes with cookies must carry a custom header. Cross-origin forms
// cannot send it; credentialed cross-origin JS is controlled by the CORS allowlist.
module.exports = function cookieCsrf(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.cookies?.token || req.cookies?.refreshToken)
    && !req.headers.authorization && req.headers['x-totmart-request'] !== '1') {
    return res.status(403).json({ success: false, message: 'Missing request verification header' });
  }
  next();
};
