# Hardening Phase 7 — Documentation & Reality Synchronization

## 1. Mục tiêu và bối cảnh

Đồng bộ hóa tài liệu dự án với hiện trạng thực tế của mã nguồn sau các giai đoạn cải tiến, loại bỏ các thông tin lỗi thời và mâu thuẫn, đồng thời lập bản đồ nợ kỹ thuật định danh route mà không phá vỡ hợp đồng với Frontend.

## 2. Các thay đổi đã thực hiện

1. **Viết lại toàn diện `README.md`**:
   - Loại bỏ mục "Known gaps" lỗi thời:
     - Làm rõ `authController.forgotPassword` sử dụng `config.frontendUrl` (không hề hardcode onrender).
     - Làm rõ `cartController.js` sử dụng trường chuẩn hóa `subscriptionPlanId` (không còn lỗi `subcricePlanId`).
   - Cập nhật công nghệ và kiến trúc: Node.js 24, Express 5, Mongoose 8 (replica set), Redis 7.4.
   - Cập nhật bảng biến môi trường đầy đủ: bổ sung các biến timeout Mongo (`MONGO_SOCKET_TIMEOUT_MS`, `MONGO_WAIT_QUEUE_TIMEOUT_MS`, `MONGO_MAX_COMMIT_TIME_MS`, `MONGO_TRANSACTION_TIMEOUT_MS`), `BCRYPT_COST`, `TRUST_PROXY`, `TRUST_PROXY_CONFIRMED_DIRECT`, `REDIS_URL`, `REDIS_NAMESPACE`.
   - Cập nhật số liệu kiểm thử chính xác: 89 test suites, 919 automated tests.
   - Làm rõ quy trình thanh toán SePay VietQR (thay thế mọi hiểu lầm về VNPay), hai tầng rate limiter và sổ cái kế toán kép.

2. **Khảo sát thư mục `fe-handover/`**:
   - Đối chiếu cho thấy `fe-handover/` là bản sao các hợp đồng từ `docs/`. Grep toàn bộ codebase xác nhận không có bất kỳ test suite hay script nào phụ thuộc vào đường dẫn `fe-handover/`.
   - Khuyến nghị: Giữ `docs/` là nguồn sự thật duy nhất (Single Source of Truth).

3. **Lập tài liệu nợ định danh Route (`docs/route-naming-debt.md`)**:
   - Ghi nhận chi tiết các lỗi chính tả tiếng Anh (`subcribe` thay vì `subscribe`).
   - Ghi nhận các endpoint RPC-style (dùng động từ trong URL thay vì HTTP methods chuẩn REST: `create-category`, `get-all-box`, `add-to-cart`...).
   - Đề xuất lộ trình chuyển đổi 4 giai đoạn an toàn (Deprecation & Migration Roadmap) bằng dual-routing / aliases và `Deprecation` / `Sunset` headers theo chuẩn RFC 8594.

## 3. Kết quả kiểm chứng

- `npm run validate:api`: **PASS**.
- `tests/apiContract.test.js`: **PASS (2/2 tests)**.
- `tests/roundC2Verification.test.js` & `tests/evidenceVerification.test.js`: **PASS (80/80 tests)**.
- `npm run lint`: **PASS (0 debt, 0 violations)**.
- `npm run format:check`: **PASS (0 invalid)**.
