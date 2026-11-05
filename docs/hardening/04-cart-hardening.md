# Hardening Phase 4 — Cart Updates: Lost Update Prevention & Validation

## 1. Mục tiêu và bối cảnh

Phase 4 tập trung giải quyết khiếm khuyết trong các thao tác giỏ hàng (`src/controllers/cartController.js` và `src/routes/cartRouter.js`):

1. **Lost Update do race condition**: Trước đây, các hàm thêm/sửa giỏ hàng (`addToCart`, `updateCart`, `addSubscribeCart`, `updateSubscribeCart`) thực hiện cơ chế read-modify-write thuần túy (`Cart.findOne` -> chỉnh sửa array -> `cart.save()`). Khi có nhiều request đồng thời, do `Cart` schema bật `optimisticConcurrency: true`, các request chạy song song sẽ bị lỗi `VersionError` (500) hoặc ghi đè mất các lần tăng số lượng.
2. **Lệch pha `totalPrice`**: `cart.totalPrice` bị tính lặp và lệch giữa các phép cộng dồn thủ công (`totalPrice += ...`, dùng sai `basePrice` thay vì `discountPrice` trong subscribe plan) và hàm `refreshTotal` (tính giá chuẩn hóa qua `buildQuote` và `SubscriptionTemplate`).
3. **Thiếu sót Joi validation**: `addSubscribeCart` và `updateSubscribeCart` đọc trực tiếp từ `req.body` thay vì `req.validatedBody`; các route có param `:_id` (`update-cart/:_id`, `delete-from-cart/:_id`, `delete-from-subscribe-cart/:_id`) chưa kiểm tra tính hợp lệ của ObjectId trong params.

## 2. Các thay đổi đã thực hiện

1. **Kiểm soát và chuẩn hóa Joi Validation (`src/routes/cartRouter.js`)**:
   - Thêm `validationHandler.validate(idParamSchema, 'params')` cho các endpoints:
     - `PUT /api/carts/update-cart/:_id`
     - `DELETE /api/carts/delete-from-cart/:_id`
     - `DELETE /api/carts/delete-from-subscribe-cart/:_id`
   - Bắt buộc kiểm tra `subscriptionCartSchema` (`subscriptionPlanId` là 24-hex string, `quantity` là integer từ 1 đến 999) cho `POST /add-subscribe-plan-to-cart` và `PUT /update-subscribe-cart`.
   - Cập nhật controller đọc dữ liệu đã validate từ `req.validatedBody`.

2. **Khử hoàn toàn Lost Update bằng Retry Loop có Jitter Backoff (`src/controllers/cartController.js`)**:
   - Triển khai vòng lặp retry (tối đa 25 lần) bắt giữ các lỗi tranh chấp phiên bản (`VersionError`) hoặc xung đột tạo mới ban đầu (Mongo error 11000 trên unique index `{ userId: 1, isSubscribeCart: 1 }`).
   - Khi xảy ra va chạm phiên bản do các request song song, request thất bại sẽ tự động chờ với khoảng thời gian ngẫu nhiên (jitter 10-30ms), đọc lại phiên bản mới nhất của giỏ hàng và áp dụng cập nhật.

3. **`refreshTotal` là nguồn sự thật duy nhất (Single Source of Truth) cho `totalPrice`**:
   - Xóa bỏ toàn bộ các dòng lệnh cộng/trừ `totalPrice` thủ công (`+=`, `-=`) rải rác trước khi lưu.
   - Mọi thay đổi số lượng, thêm mới hoặc xóa item đều được ủy quyền cho `refreshTotal` tính toán chính xác từ `buildQuote` (sản phẩm thông thường, áp dụng phân tầng bulk discount) và `discountPrice` của `SubscriptionTemplate` (giỏ đăng ký gói).

## 3. Kết quả kiểm chứng

- **Test suite mới (`tests/cartConcurrencyAndValidation.test.js`)**:
  - Gồm 20 test cases kiểm chứng input validation: từ chối ObjectId sai định dạng, quantity âm, quantity = 0, quantity > 999, quantity số thực cho cả giỏ hàng thường và giỏ đăng ký.
  - 3 test cases đồng thời (concurrency):
    - Gửi 10 request `add-to-cart` song song khi chưa có giỏ: kết quả tổng quantity chính xác 20, tính đúng chiết khấu bulk.
    - Gửi 10 request `add-to-cart` song song khi đã có giỏ (initial quantity 3): kết quả tổng quantity chính xác 13.
    - Gửi 10 request `add-subscribe-plan-to-cart` song song: kết quả tổng quantity chính xác 10, tính đúng giá gói.
  - **Chạy kiểm chứng độ ổn định: 5 lần liên tiếp 100% PASS** (23/23 tests mỗi lần).
- **Regression suites**:
  - `tests/cartSync.test.js`: 13/13 tests PASS.
  - `tests/checkoutSessionFlow.test.js`: 8/8 tests PASS.
  - `tests/orderCharacterization.integration.test.js`: PASS.
  - `tests/commercePolicy.test.js`: 14/14 tests PASS.
  - `tests/commerce.integration.test.js`: 3/3 tests PASS.
- **Chất lượng mã nguồn**:
  - `npm run lint`: 0 violations.
  - `npm run format:check`: 0 invalid.
  - `npm run validate:api`: 11 operations, 8 examples validated.
