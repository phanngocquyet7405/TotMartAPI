const jwt = require("jsonwebtoken");
const config = require("../config/environment");

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    config.jwt.secret,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "30m" },
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      tokenVersion: user.tokenVersion || 0,
    },
    process.env.JWT_REFRESH_SECRET || config.jwt.secret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" },
  );
};

const generateToken = (userId, tokenVersion = 0) => {
  return jwt.sign({ userId, tokenVersion }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn || "1d",
  });
};

const verifyToken = (token, isRefresh = false) => {
  try {
    const secret = isRefresh
      ? process.env.JWT_REFRESH_SECRET || config.jwt.secret
      : config.jwt.secret;
    const decoded = jwt.verify(token, secret);
    return decoded;
  } catch (error) {
    throw error;
  }
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
