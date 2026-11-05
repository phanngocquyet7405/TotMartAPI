# Báo cáo Giai đoạn 8: Mở rộng Contract Testing & OpenAPI Specification

## 1. Mục tiêu
- Mở rộng đặc tả OpenAPI (`docs/api.openapi.json`) từ 11 lên 28 operations, bao quát các miền cốt lõi: Checkout, Cart, Users, Home/Health.
- Đảm bảo 100% operations tuân thủ đầy đủ 4 metadata extensions bắt buộc theo `UNIFIED-COMMERCE-CONTRACT.md`:
  - `x-csrf`: Ràng buộc CSRF token hoặc header `X-TotMart-Request: 1` cho cookie-based writes.
  - `x-ownership`: Ràng buộc định danh người dùng / merchant từ token xác thực.
  - `x-idempotency`: Ràng buộc tính bất biến khi retry với cùng payload hash hoặc state-guard.
  - `x-retry-recovery`: Ràng buộc cơ chế phục hồi khi gặp lỗi tạm thời (503 / 409 canRestart).
- Chuẩn hóa kiểu dữ liệu tương thích OpenAPI 3.0.3 (thay thế `type: ['object', 'null']` bằng `type: 'object', nullable: true`).
- Bổ sung synthetic contract examples trong `docs/api-examples.json` và đồng bộ đồng nhất với `fe-handover/`.
- Cập nhật test contract trong `tests/apiContract.test.js` xác minh tính hợp lệ qua SwaggerParser và Ajv.

---

## 2. Các Operations Bổ Sung (17 operations mới + 11 cũ = 28 operations)

### Nhóm Checkout (7 endpoints)
1. `POST /checkout/quote`: Tính toán giỏ hàng, chiết khấu combo, quà tặng, mã giảm giá.
2. `POST /checkout/cancel/{_id}`: Hủy đơn hàng đang chờ thanh toán và hoàn trả kho/voucher.
3. `GET /checkout/sessions/{paymentCode}`: Tra cứu trạng thái phiên thanh toán SePay.
4. `POST /checkout/sessions/{paymentCode}/cancel`: Hủy phiên thanh toán và giải phóng coupon.
5. `GET /checkout/order-status/{paymentCode}`: Tra cứu trạng thái đơn hàng theo mã thanh toán.
6. `POST /checkout/orders/{_id}/items/{itemId}/cancel`: Hủy từng item trong đơn hàng.
7. `GET /checkout/my-orders`: Lấy danh sách đơn hàng của người dùng hiện hành.

### Nhóm Cart (6 endpoints)
8. `GET /cart`: Lấy thông tin giỏ hàng kèm tính toán realtime.
9. `POST /cart/add`: Thêm sản phẩm vào giỏ hàng với kiểm tra tồn kho.
10. `PUT /cart/update`: Cập nhật số lượng sản phẩm trong giỏ.
11. `DELETE /cart/remove/{_id}`: Xóa một mục khỏi giỏ hàng.
12. `POST /cart/sync`: Đồng bộ giỏ hàng offline của khách với database khi đăng nhập.
13. `POST /cart/subscribe`: Thêm gói đăng ký định kỳ vào giỏ hàng.

### Nhóm Users (3 endpoints)
14. `GET /users/profile`: Lấy thông tin tài khoản người dùng đăng nhập.
15. `POST /users/forgot-password`: Yêu cầu gửi email khôi phục mật khẩu.
16. `POST /users/reset-password`: Đặt lại mật khẩu với token một lần.

### Nhóm System Health (1 endpoint)
17. `GET /home/health`: Thăm dò trạng thái kết nối DB và Redis.

---

## 3. Các Schemas & Examples Mới

- `SuccessResponse`: Cấu trúc chuẩn `{ success: true, message: string, data: object|null }`.
- `HealthResponse`: Cấu trúc `{ status: "ok", db: string, redis: string, uptime: number, timestamp: string }`.
- `QuoteResponse`: Phản hồi tính toán báo giá thương mại.
- `CartResponse`: Phản hồi trạng thái giỏ hàng sau đột biến.
- `SyncCartResponse`: Phản hồi kết quả merge giỏ offline/online kèm danh sách sản phẩm bị skip.
- `SubscribeCartResponse`: Phản hồi giỏ hàng đăng ký subscription kèm danh sách gift.
- `CheckoutSessionResponse`: Trạng thái phiên thanh toán SePay.
- `OrderStatusResponse`: Trạng thái đơn hàng.

Tất cả các schema đều được xác thực 2 chiều:
1. `SwaggerParser.validate` xác nhận cấu trúc chuẩn OpenAPI 3.0.3.
2. `Ajv` biên dịch và kiểm tra tính hợp lệ của tất cả 12 synthetic examples đối với runtime JSON schemas.
3. `Joi` runtime schema xác thực các payload đầu vào tương thích với middleware nghiệp vụ.

---

## 4. Kết Quả Kiểm Chứng

1. **`npm run validate:api`**:
   ```json
   {"operations":28,"examples":12}
   ```
   - 28/28 operations có đủ 4 extensions (`x-csrf`, `x-ownership`, `x-idempotency`, `x-retry-recovery`).
   - 12/12 contract examples hợp lệ 100%.

2. **`npm test -- --runTestsByPath tests/apiContract.test.js`**:
   - `PASS tests/apiContract.test.js`: 2/2 tests pass (OpenAPI validation & middleware CSRF/Auth error conformance).

3. **`npm run lint`**:
   - 0 debt errors, 0 violations trên 332 files.
