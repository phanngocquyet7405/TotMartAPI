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
const config = require("./config/environment");
const app = express();

app.set("trust proxy", 1);

// Middleware
app.use(helmet());

if (config.nodeEnv !== "test") {
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/api/home/health",
      },
    }),
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(
        new Error(`Origin "${origin}" không được phép truy cập bởi CORS`),
      );
    },
    credentials: true,
  }),
);
app.use(cookieParser());
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
