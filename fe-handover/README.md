# HỒ SƠ BÀN GIAO BACKEND CHO FRONTEND (TOTMART API)

Thư mục này chứa đầy đủ tài liệu đặc tả, hợp đồng API và hướng dẫn tích hợp dành riêng cho Team Frontend khi làm việc với hệ thống TotMart Backend.

---

## 1. Danh mục các file bàn giao trong thư mục

| Tên file | Mục đích & Nội dung | Đối tượng sử dụng |
| :--- | :--- | :--- |
| **`FE-BE-contract-handoff.md`** | **Tài liệu cốt lõi nhất:** Tổng hợp toàn bộ hợp đồng bàn giao FE, envelopes HTTP, xác thực session/cookie, giới hạn timeout CSOT, attempt recovery, và lưu ý bảo mật. | Toàn bộ FE Team |
| **`api.openapi.json`** | Đặc tả OpenAPI / Swagger schema chuẩn của các endpoint chính. Dùng để import vào Postman, Swagger UI hoặc generate API client types (TypeScript). | FE Dev / QA |
| **`api-examples.json`** | Bộ dữ liệu payload mẫu (request / response) cho các luồng nghiệp vụ phổ biến. | FE Dev / QA |
| **`checkout-attempt-contract.md`** | Đặc tả chi tiết về vòng đời Attempt, cơ chế chống trùng lặp (`Idempotency-Key`), băm dữ liệu (`Attempt-Payload-Hash`), và quy trình khôi phục khi mất mạng (`terminate-with-body`). | FE Dev làm Cart/Checkout |
| **`UNIFIED-COMMERCE-CONTRACT.md`** | Hợp đồng thương mại hợp nhất: Quy tắc số tiền VND (safe integer), SePay QR webhook, trạng thái đơn hàng, và phân tách nghĩa vụ. | FE Dev làm Payment/Orders |
| **`COMMERCE-FE-V2.md`** | Quy chuẩn phân tách phí ship (`shippingPayment = customer_to_carrier`), chuẩn hóa địa chỉ, gói subscription, hộp quà (gift/box). | FE Dev làm Checkout/Plans |
| **`MANAGER-API-CONTRACT.md`** | Đặc tả API và phân quyền dành cho phân hệ Merchant Manager (chủ shop quản lý sản phẩm/đơn hàng). | FE Dev làm trang Merchant |
| **`MERCHANT-OPERATING-MODEL.md`** | Mô hình vận hành, giới hạn quyền của Merchant (không can thiệp đối soát tiền mặt/admin). | FE Dev / PM / BA |

---

## 2. Các quy tắc kỹ thuật bắt buộc khi cấu hình HTTP Client (FE)

### a. Cookie & Thông tin xác thực (Credentials)
- Backend sử dụng cơ chế kết hợp: **Access Token** ngắn hạn (15 phút) và **Refresh Token** dạng Opaque trong HttpOnly Cookie (`SameSite=Lax`, `Secure` trên Staging/Production).
- Tất cả request từ Frontend gọi sang Backend **bắt buộc phải bật gửi kèm cookie**:
  - Với Axios: `axios.defaults.withCredentials = true;`
  - Với Fetch: `fetch(url, { credentials: 'include', ... })`

### b. Header bảo mật CSRF
- Mọi request ghi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`) thực hiện bằng Cookie mà không có header `Authorization: Bearer <token>` **bắt buộc phải gửi kèm header**:
  ```http
  X-TotMart-Request: 1
  ```
  *(Nếu thiếu header này, request sẽ bị từ chối 403 Forbidden).*

### c. Chống Race Condition khi Refresh Token (Đa tab)
- Khi Access Token hết hạn, FE cần gom các request refresh (request coalescing/serializing).
- Hệ thống hỗ trợ tối đa 2 lần retry token kế tiếp trong vòng 30 giây. Nếu nhiều tab cùng gọi refresh riêng rẽ làm sai lệch chuỗi kế thừa token, toàn bộ phiên đăng nhập (Session Family) sẽ bị thu hồi và người dùng bị văng ra trang login.

### d. Ràng buộc Mật khẩu & Đăng nhập
- **Độ dài mật khẩu:** Tối thiểu 8 ký tự, tối đa **72 UTF-8 bytes** (ràng buộc của thuật toán bcrypt an toàn).
- **Yêu cầu đổi mật khẩu:** Khi login trả về cờ `passwordChangeRequired: true` (với lý do `LEGACY_BCRYPT_BYTE_LIMIT`), FE phải điều hướng người dùng tới trang đổi mật khẩu mới thay vì chỉ lưu token và vào trang chủ.

---

## 3. Quy chuẩn Đặt hàng (Checkout) & Khôi phục khi mất kết nối

Hệ thống TotMart áp dụng cơ chế Idempotency nghiêm ngặt để đảm bảo **không bao giờ trừ tiền hoặc tạo đơn hàng trùng lặp**:

1. **Gửi Request:** Mỗi lần bấm "Thanh toán", FE sinh một `Idempotency-Key` (chuỗi ngẫu nhiên 16–128 ký tự `^[A-Za-z0-9_-]{16,128}$`). Gửi qua header:
   ```http
   Idempotency-Key: <key>
   ```
2. **Lưu trữ cục bộ:** FE phải lưu lại `key` và `requestBody` gốc vào bộ nhớ tạm trình duyệt (sessionStorage/localStorage).
3. **Khi gặp Timeout hoặc lỗi 5xx / 503:**
   - **Tuyệt đối KHÔNG tự ý sinh `Idempotency-Key` mới** để thử lại (sẽ bị xem là đơn mua mới hoặc xung đột 409).
   - FE sử dụng endpoint:
     `POST /api/checkout/attempts/products/:key/terminate-with-body`
     (gửi nguyên `requestBody` đã lưu).
   - Nếu đơn hàng thực tế đã được commit thành công trên server, API sẽ trả về kết quả đơn cũ (`created` với `canRestart: false`) để FE hiển thị trang thành công.
   - Chỉ khi API xác nhận `invalidated` với `canRestart: true`, FE mới được phép mở lại form cho khách đặt lại.

---

## 4. Chuẩn phản hồi lỗi (Error Envelopes)

Mọi response lỗi đều đi qua format chuẩn:
```json
{
  "success": false,
  "status": 400,
  "message": "Thông báo lỗi",
  "requestId": "uuid-cua-request",
  "code": "MA_LOI_NGHIEP_VU",
  "fields": {}
}
```

- **Lỗi 5xx:** Trên môi trường Staging/Production, chi tiết kỹ thuật bên trong được ẩn đi và luôn trả về message cố định: `Lỗi hệ thống. Vui lòng thử lại.` kèm theo `requestId`.
- **Hỗ trợ & Báo lỗi:** Khi FE báo lỗi về BE, **luôn cung cấp mã `requestId`** lấy từ response để BE đối chiếu log chính xác tức thì.

---

## 5. Checklist kiểm thử nghiệm thu (Acceptance Criteria cho FE)

Trước khi nghiệm thu giao diện, FE cần tự kiểm tra các ca sau:
- [ ] Gửi request login/register/checkout với mật khẩu có ký tự Unicode và kiểm tra chặn độ dài theo 72 UTF-8 byte.
- [ ] Bật 2 tab cùng lúc, thực hiện các thao tác khi token hết hạn để kiểm tra luồng refresh token không bị văng đăng nhập.
- [ ] Mất kết nối mạng (hoặc ngắt mạng tạm thời trong DevTools) ngay khi bấm Đặt hàng, sau đó khôi phục lại mạng và kiểm tra đơn có bị tạo lặp hay không.
- [ ] Kiểm tra hiển thị đúng mã QR thanh toán từ `paymentCode` và cơ chế polling trạng thái tiền `/api/checkout/order-status/:paymentCode`.
- [ ] Kiểm tra hiển thị thông báo lỗi thân thiện kèm `requestId` khi server trả về mã lỗi 500/503.
