# TotMartAPI — Báo cáo Tối ưu Độ trễ Request (Giai đoạn 4)

## 1. Mục tiêu và phạm vi thực hiện
Giai đoạn 4 tập trung giảm thiểu độ trễ xử lý request (request latency) nhằm thích ứng với môi trường Render Free (0.1 vCPU, 512MB RAM rất nhạy cảm với CPU bound và network I/O bound):
1. **Song song hóa xác thực trong Auth Middleware**:
   - Chuyển `User.findById(...)` và `AuthSession.exists(...)` từ tuần tự sang song song qua `Promise.all`.
   - Giảm một nửa số round-trip network I/O tới MongoDB trên mỗi request có token xác thực.
   - Bảo toàn chặt chẽ thứ tự validation in-memory (`user`, `user.isActive`, `tokenVersion`, `sessionExists`).
2. **Cấu hình Connection Pool cho Mongoose**:
   - Thêm `minPoolSize: 2`, `maxPoolSize: 10`, `maxIdleTimeMS: 45000` vào [`src/config/resolveEnvironment.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/config/resolveEnvironment.js) và [`src/config/database.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/config/database.js).
   - Duy trì sẵn 2 socket kết nối tối thiểu để loại bỏ chi phí TLS handshake và TCP connection setup sau mỗi khoảng thời gian nhàn rỗi (idle).
3. **Thêm Projection và `.lean()` cho các Read Query**:
   - `src/controllers/userController.js`: `getMyProfile` chỉ select các trường hồ sơ công khai, loại trừ hash nhạy cảm (`-password -refreshToken -resetPasswordToken -resetPasswordExpires`) và dùng `.lean()`.
   - `src/controllers/categoryController.js`: `getAllCategories` và `getCategoryById` gắn `.lean()`.
   - `src/controllers/brandController.js`: `getManagedBrand`, `getBrandProducts`, và `getAllBrands` (thông qua `paginate`) gắn `.lean()`.
   - `src/controllers/productController.js`: `getAllProducts` và `getProductById` gắn `.lean()`.
   - `src/utils/pagination.js`: Hỗ trợ tùy chọn `options.lean` khi phân trang.

---

## 2. Bảng so sánh hiệu năng (Baseline Phase 0 vs Phase 4)

Được đo độc lập bằng [`scripts/perf/benchmark-baseline.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/scripts/perf/benchmark-baseline.js) trên cùng môi trường local một node (MongoDB 7.0.14 WiredTiger, Docker Redis disposable):

| Chỉ số / Endpoint | Giai đoạn 0 (Baseline) | Giai đoạn 4 (Tối ưu) | Mức cải thiện (%) |
| :--- | :---: | :---: | :---: |
| **Port open** | 373 ms | **2 ms** | **-99.5%** |
| **Liveness 200 OK** | 2,219 ms | **1,741 ms** | **-21.5%** |
| **Readiness 200 OK** | 2,224 ms | **2,099 ms** | **-5.6%** |
| **Catalog p50** (`GET /api/products/get-all-products/`) | 4.01 ms | **3.33 ms** | **-17.0%** |
| **Catalog p95** | 6.03 ms | **5.30 ms** | **-12.1%** |
| **Catalog Throughput** | 233.1 req/s | **274.5 req/s** | **+17.8%** |
| **Cart có auth p50** (`GET /api/carts/get-cart/:id`) | 5.89 ms | **5.08 ms** | **-13.8%** |
| **Cart có auth p95** | 7.36 ms | **6.86 ms** | **-6.8%** |
| **Cart có auth Throughput** | 163.1 req/s | **186.7 req/s** | **+14.5%** |
| **User profile có auth p50** (`GET /api/users/get-user-by-id/:id`) | 3.80 ms | **2.60 ms** | **-31.6%** |
| **User profile có auth p95** | 5.52 ms | **4.27 ms** | **-22.6%** |
| **User profile có auth Throughput** | 255.2 req/s | **345.7 req/s** | **+35.5%** |

---

## 3. Kết quả kiểm chứng tự động

- **Targeted Unit / Integration Tests**: 55/55 passed (`httpKeepAliveAndCompression.test.js`, `authPerformance.test.js`, `apiContract.test.js`, `stockAdjust.test.js`, `resolveEnvironment.test.js`).
- **Auth Boundary & Security Regression**: 38/38 passed (`accountLock.test.js`, `passwordResetStreams.test.js`, `authBoundary.integration.test.js`).
- **Commerce / Checkout Regression**: 15/15 passed (`checkout.test.js`).
- **Webhook & Rate Limiting**: 17/17 passed (`webhook.test.js`, `proxyAndWebhookRateLimit.test.js`).
- **Manager & Merchant Order Policy**: 21/21 passed (`manager.integration.test.js`, `merchantOrderPolicy.test.js`).
- **Quality Gates**:
  - `npm run format:check`: 347 files checked, 0 invalid.
  - `npm run lint`: 337 files scanned, 0 debt errors, 0 violations.
  - `npm run validate:api`: 28 operations, 12 examples validated.
