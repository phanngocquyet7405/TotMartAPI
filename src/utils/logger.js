const pino = require("pino");
const config = require("../config/environment");

const usePrettyTransport = config.nodeEnv === "development";

const logger = pino({
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "password", "token", "refreshToken", "email", "phone", "shippingAddress"], censor: "[REDACTED]" },
  level:
    process.env.LOG_LEVEL ||
    (config.nodeEnv === "production" ? "info" : "debug"),
  transport: usePrettyTransport
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

module.exports = logger;
