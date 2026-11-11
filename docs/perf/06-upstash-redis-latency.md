# TotMartAPI — Báo cáo Tối ưu Upstash Redis & Network Latency (Giai đoạn 6)

## 1. Mục tiêu và phạm vi thực hiện
Giai đoạn 6 tập trung kiểm định và tối ưu kết nối giữa TotMartAPI trên Render (Singapore) và Upstash Redis Serverless (Singapore, TLS `rediss://`), đảm bảo kết nối luôn ấm, không rò rỉ credential, không tiêu tốn hạn ngạch Upstash Free vô ích, và bảo toàn 100% chính sách bảo mật Fail-Closed:
1. **Kiểm tra và hoàn thiện cấu hình Upstash TLS (`rediss://`)**:
   - Xác minh parser URL trong [`src/config/resolveEnvironment.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/config/resolveEnvironment.js) chấp nhận giao thức `rediss:` (TLS) và trích xuất đúng tài khoản/mật khẩu phức tạp (bao gồm ký tự đệm Base64 `==` phổ biến của Upstash token).
   - Giữ vững quy tắc trong [`src/config/environmentChecks.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/config/environmentChecks.js): Môi trường production bắt buộc phải sử dụng TLS (`rediss://`), từ chối khởi động nếu dùng `redis://` không mã hóa.
   - Node-redis client khởi tạo với cờ TLS tự động `client.options.socket.tls = true`.
2. **Cấu hình TCP Keep-Alive (`REDIS_KEEP_ALIVE_MS`)**:
   - Thêm cấu hình biến môi trường `REDIS_KEEP_ALIVE_MS` (mặc định `30000`, min `1000`, max `300000`).
   - Truyền `keepAlive: config.redis.keepAliveMs || 30000` vào thuộc tính `socket` của `createClient` trong [`src/config/redis.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/config/redis.js).
   - Tác dụng: Ngăn chặn các thiết bị định tuyến/NAT trung gian giữa Render SG và Upstash SG ngắt kết nối TCP ở trạng thái nhàn rỗi (idle), loại bỏ chi phí bắt tay TLS lặp lại (tiết kiệm ~15-25ms cho mỗi request phát sinh sau khoảng nghỉ).
3. **Điều chỉnh chu kỳ Health Check Ping Serverless (`REDIS_PING_INTERVAL_MS`)**:
   - Thêm biến môi trường `REDIS_PING_INTERVAL_MS` (mặc định `1000` ms cho môi trường local/test để các bài drill diễn ra nhanh chóng).
   - Trên Render production, khuyến nghị thiết lập `REDIS_PING_INTERVAL_MS=30000` (đã bổ sung vào [`render.yaml`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/render.yaml) và [`OPERATIONS.md`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/OPERATIONS.md)).
   - Tác dụng: Ping mỗi 1s sẽ tiêu tốn 172,800 lệnh/ngày, vượt xa hạn mức 10,000 lệnh/ngày của Upstash Free. Đặt 30s giúp giảm lượng ping xuống còn ~5,760 lệnh/ngày, đảm bảo hệ thống duy trì giám sát liên tục mà không làm cạn kiệt quota.
4. **Bảo toàn tuyệt đối chính sách Fail-Closed**:
   - `disableOfflineQueue: true` bảo đảm khi Redis mất kết nối, các lệnh không bị dồn ứ vô tận trong RAM gây lỗi 502/OOM.
   - Khi Redis offline trong production, `redis.getClient()` lập tức ném lỗi HTTP 503 `Shared security store unavailable`.
   - Toàn bộ các kết nối SSE đang mở bị đóng ngay lập tức (`terminateAllStreams()`) để ngăn ngừa rò rỉ phiên.
   - Rate limiting trên route nhạy cảm fail-closed ngay lập tức khi Redis gặp sự cố.

---

## 2. Kết quả kiểm chứng tự động

- **Redis Upstash & Keep-Alive Suite** ([`tests/redisUpstashTlsAndKeepAlive.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/redisUpstashTlsAndKeepAlive.test.js)): **9/9 PASS** (1.56s).
- **Environment & Parser Suite** ([`tests/resolveEnvironment.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/resolveEnvironment.test.js)): **31/31 PASS** (2.23s).
- **Real Redis Primitives Suite** ([`tests/redisLive.integration.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/redisLive.integration.test.js)): **3/3 PASS** (2.05s với Docker disposable Redis).
- **Multi-Process HTTP Outage / Crash Drill Suite** ([`tests/redisHttp.integration.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/redisHttp.integration.test.js)): **16/16 PASS** (72.06s với Docker disposable Redis).
- **Targeted Regressions**: 58/58 passed (`dockerBuildVerification.test.js`, `checkout.test.js`, `webhook.test.js`, `resolveEnvironment.test.js`).
- **Quality Gates**:
  - `npm run format:check`: 349 files checked, 0 invalid.
  - `npm run lint`: 339 files scanned, 0 debt errors, 0 violations.
  - `npm run validate:api`: 28 operations, 12 examples validated.
