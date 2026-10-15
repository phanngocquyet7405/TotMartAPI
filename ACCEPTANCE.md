# Kết quả nghiệm thu TotMart — 14/10/2026

## Kiểm thử tự động

- MongoDB thật: Docker MongoDB 7 replica set `rs0`, localhost:27018, database riêng `totmart_test`.
- Redis thật: localhost:6380; kiểm thử nhiều client, quota, GETDEL và Pub/Sub.
- Toàn bộ backend: **43 bộ, 334 bài qua, 0 bài lỗi**. Có file JSON kết quả chi tiết đi kèm.
- Frontend: **45 bài qua, 0 bài lỗi**, gồm 5 bài mới kiểm tra báo giá gift và chia tổng tiền trả trước ra bình quân mỗi tháng.
- Build production với webpack thành công; ESLint các phần thay đổi được kiểm tra.

## Các luồng đã kiểm tra bằng API và MongoDB

Gift được tạo từ combo của merchant; ba gift giá 200.000/hộp, giảm 10%, tiện ích 5.000/hộp cho tổng 555.000. Checkout và webhook giả lập đi qua API thật. Tồn sản phẩm giảm 6, tồn gift giảm 3; hủy đơn hoàn đủ tồn; số tiền refund được ghi 555.000. Merchant khác không thấy đơn.

Gói hàng lẻ 3 tháng giá nền 300.000, giảm 10%, thu trước 270.000; thanh toán giả lập kích hoạt đăng ký; hủy tạo refund subscription. Các bài sẵn có còn kiểm tra retry/idempotency, thanh toán thiếu/thừa, hết hạn, đồng thời, version cấu phần, khóa tài khoản và hủy/hoàn kho.

Admin bị chặn chuyển sản phẩm sang thương hiệu của chủ khác và chuyển thương hiệu đang có sản phẩm xung đột. Merchant bị chặn các thao tác gán chủ của admin. API summary vận hành chỉ cho admin, không trả dữ liệu khách.

## Các bước đã nghiệm thu trên trình duyệt

- Merchant 1 chỉ thấy `merchant1 product`; tạo gift có giảm lượng/thiệp thành công; tạo gói hàng lẻ ba tháng thành công, manager hiển thị 270.000.
- Merchant 2 chỉ thấy `merchant2 product`; mở `/admin-users` bị chuyển về `/manager`.
- Admin vào dashboard, tạo thương hiệu cho merchant 2 qua ô chọn merchant; thương hiệu xuất hiện trong danh sách.
- Khách đăng nhập, mở gift, chọn ba hộp; chi tiết tính 555.000. Checkout lấy giá backend, hiển thị giảm lượng 60.000, tiện ích 15.000, tiền hàng 555.000.
- Bước bấm tạo QR bị auto-review yêu cầu người dùng tự thực hiện. Người dùng đã bấm tạo đơn thử; trang chờ thanh toán hiển thị đúng 555.000 và bank thử `TestBank`. Ảnh QR không tải được do thông tin ngân hàng thử không phải ngân hàng thật; không có chuyển tiền thật.

## Lỗi phát hiện và sửa trong nghiệm thu

1. Email fixture `.local` bị Joi từ chối: chuyển sang email thử trong domain `totmart-test.example.com`.
2. Giỏ bật bên cạnh dùng giá niêm yết, khác giá checkout gift: bổ sung báo giá backend, chặn kết quả cũ theo scope/giỏ, ghép dòng theo loại/ID/số lượng/thông điệp. Nếu chưa có báo giá, ghi rõ là giá niêm yết.
3. Trang gói đăng ký lấy tổng ba tháng gắn nhãn mỗi tháng: chuẩn hóa riêng, dùng bình quân theo số kỳ; 270.000/3 = 90.000/tháng. Loại bỏ một số cam kết vận chuyển/hoàn tiền tĩnh không có căn cứ.
4. Header admin hiển thị email cố định: lấy thông tin phiên hiện tại; gắn hành động đăng xuất.
5. Script mở frontend bị mất dấu phân cách đường dẫn: sửa và đối chiếu file build thực tế.

Sau khi frontend khởi động lại, đã xác minh trực tiếp: gói 270.000/3 tháng hiển thị 90.000/tháng; giỏ ba gift nhận báo giá 555.000 từ backend (540.000 tiền hàng sau giảm + 15.000 tiện ích). Ảnh customer-cart-final.jpg ghi nhận giao diện cuối. Nội dung quảng bá mẫu về Nhật Bản/chủ đề/quà tặng trên trang đăng ký vẫn cần biên tập theo danh mục thật trước khi công khai.

## Cải tổ mã và vận hành

Nghiệp vụ tạo gift/gói hàng lẻ và kiểm tra cấu phần chuyển vào `managerService`. Frontend có ProductForm, ComboForm, SubscriptionForm, GiftForm riêng, phần gọi API trong managerApi. Probe liveness/readiness đã trả 200; thêm summary outbox/refund chỉ dành admin, script probe và hướng dẫn xử lý sự cố.

Backup/restore đã có script tạo archive/SHA-256 và restore vào namespace mới. **Chưa chạy backup/restore drill** vì chưa có mongodump/mongorestore; không khẳng định RPO/RTO hoặc phục hồi production.

## Những việc chưa được xác nhận

- Chuyển tiền SePay thật, ảnh QR với ngân hàng thật, webhook từ nhà cung cấp.
- Gửi email Brevo/ảnh Cloudinary thật; môi trường nghiệm thu chỉ dùng fixture không upload và khóa thử.
- Scheduler delivery/outbox trong production luôn chạy, dịch vụ giám sát gửi cảnh báo, và backup phục hồi thực.
- Toàn bộ mọi màn hình/thiết bị: đã nghiệm thu các đường đi cụ thể trên một trình duyệt, không phải coverage E2E hoàn chỉnh.

Đơn thử trên browser còn pending; không sửa nó thành paid để thay cho kiểm chứng ngân hàng. Các thao tác paid/cancel/refund được kiểm tra trong database test riêng bằng webhook mô phỏng.

