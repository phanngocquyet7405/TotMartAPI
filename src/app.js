const express = require("express");
const querystring = require("querystring");
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const cors = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const pinoHttp = require("pino-http");
const logger = require("./utils/logger");
const { reqSerializer } = require("./utils/logRedaction");
const config = require("./config/environment");
const app = express();

const proxy = process.env.TRUST_PROXY ?? '0';
app.set('trust proxy', /^[01]$/.test(proxy) ? Number(proxy) : proxy);
app.use((req, res, next) => {
  req.id = require('crypto').randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});

// Middleware
app.use(helmet());

if (config.nodeEnv !== "test") {
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/api/home/health",
      },
      // Không ghi token/vé nằm trong query string vào log.
      serializers: { req: reqSerializer },
    }),
  );
}

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.set("query parser", (str) =>
  mongoSanitize.sanitize(querystring.parse(str)),
);
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.params) mongoSanitize.sanitize(req.params);
  next();
});

const allowedOrigins = (process.env.CORS_ORIGINS || config.frontendUrl)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // 403 thay vì 500: đây là yêu cầu bị từ chối, không phải lỗi máy chủ.
      // Không in lại giá trị Origin do client gửi lên.
      return callback(
        Object.assign(new Error("Origin không được phép truy cập"), {
          status: 403,
        }),
      );
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(require("./middleware/cookieCsrf"));
// Routes
routes(app);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use(errorHandler);

module.exports = app;
