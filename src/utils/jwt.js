const jwt = require('jsonwebtoken');
const config = require('../config/environment');

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.legacyAccessExpiresIn },
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      tokenVersion: user.tokenVersion || 0,
    },
    config.jwt.legacyRefreshSecret,
    { expiresIn: config.jwt.legacyRefreshExpiresIn },
  );
};

const generateToken = (userId, tokenVersion = 0) => {
  return jwt.sign({ userId, tokenVersion }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn || '1d',
  });
};

const verifyToken = (token, isRefresh = false) => {
  const secret = isRefresh ? config.jwt.legacyRefreshSecret : config.jwt.secret;
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  return decoded;
};

const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateToken,
  verifyToken,
  decodeToken,
};
