const express = require('express');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const cors = require('cors')
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config/environment');
const app = express();

// Middleware
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==== CORS: chỉ cho phép các origin trong allowlist thay vì mở cho tất cả ====
// CORS_ORIGINS (.env): danh sách domain FE hợp lệ, phân cách bởi dấu phẩy.
// Nếu không cấu hình, fallback về FRONTEND_URL (giữ tương thích ngược).
const allowedOrigins = (process.env.CORS_ORIGINS || config.frontendUrl)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Không có origin = request server-to-server / curl / webhook, cho qua
    // (SePay webhook không set Origin header)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin "${origin}" không được phép truy cập bởi CORS`));
  },
  credentials: true,
}));
app.use(cookieParser());
// Routes
routes(app);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

module.exports = app;
