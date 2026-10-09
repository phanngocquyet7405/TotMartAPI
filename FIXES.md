# Thay đổi nghiệp vụ và triển khai

Bản sửa đi cùng FE mới. Chi tiết bàn giao đầy đủ nằm trong `huong-dan-ban-sua-totmart.md` ở gói tải xuống.

- Checkout dùng giá BE, Idempotency-Key, transaction, một bản ghi Checkout chung cho nhiều người bán.
- Cart phân biệt product/box; báo giá box tính theo giá hộp và giữ cả kho hộp lẫn cấu phần.
- Ghi nhận webhook vào PaymentEvent; giao dịch thiếu tiền, quá hạn hoặc không khớp giữ lại để đối soát.
- Coupon dùng một lượt cho cả checkout; hoàn lượt một lần khi toàn bộ checkout bị hủy.
- Subscription thu trước toàn bộ: giá hộp × 3/6/12 tháng rồi giảm giá. Chỉ kích hoạt sau khi nhận đủ tiền. Lượt đầu đến hạn sau một tháng.
- Scheduler chỉ tạo yêu cầu giao; dispatch giữ kho, deliver mới giảm số lượt. Quà giao trong lượt đầu.
- Hoàn tiền là hàng đợi xử lý thủ công, xác nhận bằng số tiền khớp và mã giao dịch; không tự chuyển tiền ngân hàng.
- Cookie HttpOnly, access JWT mặc định 15 phút, refresh token opaque được băm và xoay vòng, phiên có thể thu hồi.
- HTML có allowlist, upload giữ ảnh thuộc đúng sản phẩm, lỗi không làm mất ảnh cũ.
- Outbox lưu yêu cầu thông báo cùng transaction và tự thử lại.

## Chạy local

Node 22 hoặc 24. MongoDB phải là replica set; transaction không chạy trên standalone.

1. `npm ci`.
2. Sao chép `.env.example` thành `.env`; điền biến thực tế. Khi chạy local, đặt FRONTEND_URL và CORS_ORIGINS thành `http://localhost:3000`. BE mặc định cổng 3001.
3. `npm run dev`.
4. `npm test`. Bộ test tự tạo MongoMemoryReplSet; cần quyền tải và chạy mongod. Hoặc đặt TEST_MONGODB_URI trỏ tới MongoDB thử nghiệm trên localhost, tên DB bắt buộc `totmart_test`.

## Dữ liệu cũ

**Không thay ngay bản này vào production mà bỏ qua dữ liệu đang có.**

1. Sao lưu DB; chạy trên bản sao staging trước.
2. `npm run migrate:checkouts` mặc định chỉ đọc và báo cáo cart trùng, các checkout thiếu và subscription active chưa có bằng chứng paid.
3. Giải quyết cart trùng và các nhóm đơn không nhất quán theo báo cáo. Đối soát coupon lịch sử vì cách cũ có thể đã tăng usageCount theo nhiều đơn con.
4. Sau khi kiểm tra staging, `npm run migrate:checkouts -- --apply` tạo Checkout thiếu và index. Script không đổi số lượt coupon, không tự đánh dấu subscription cũ đã trả tiền.
5. Subscription cũ chỉ tiếp tục giao khi đã được đối soát và có paymentStatus=paid; kiểm tra currentPeriodStart, completeDeliveries và nextDeliveries trước khi chạy scheduler. Không suy ra paid từ status=active.
6. Tạo/kiểm tra index unique của Checkout, Cart, PaymentEvent, AuthSession, SubscriptionFulfillment, NotificationOutbox và Notification.eventKey.
7. Thay JWT_SECRET khi chuyển đổi để thu hồi token cũ. Người dùng đăng nhập lại; giỏ localStorage cũ chưa tách tài khoản không được tự nhập vào tài khoản mới.

## Giới hạn vận hành

- Rate limiter, vé và kết nối SSE vẫn ở bộ nhớ một tiến trình. Chạy một instance; trước khi scale cần shared store/pub-sub hoặc sticky routing phù hợp.
- Outbox đảm bảo lưu thông báo, không đảm bảo mỗi trình duyệt chỉ nhận SSE một lần. FE tải lại danh sách theo ID.
- Chưa gọi Cloudinary, Brevo hoặc ngân hàng thật trong kiểm thử. Xác minh trên staging bằng tài khoản thử nghiệm riêng.
- Hủy gói đã trả tiền tính phần chưa dùng: floor(price × remainDeliveries / totalDeliveries) + tiền chuyển dư. Đây là chính sách kỹ thuật tạm; cần công bố và chốt với nghiệp vụ trước khi mở chức năng cho khách.
- Đối soát thiếu tiền/chuyển lặp/hết hạn cần người vận hành; chưa tự cộng nhiều lần chuyển thiếu thành một lần thanh toán.
