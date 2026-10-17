# Áp dụng backend cập nhật merchant

Source nền: TotMartAPI-master (1).zip. Mục tiêu: backend hoạt động với payload manager của Tot-mart-staging-impeccable-cleaned, cộng quyền vận hành đơn giới hạn. Chưa deploy hay chạy migration trên database thật.

## Trình tự

1. Tạo Git checkpoint/backup. So diff với repo đang dùng nếu đã có thay đổi mới hơn ZIP. Không chép đè .env thật.
2. Dùng Node >=22.12 và <25, npm ci. Dependencies và package-lock không đổi; npm scripts mới chỉ giúp chạy test manager/migration.
3. Dùng database local/staging **replica set** để transaction hoạt động. Cấu hình JWT/CORS/Redis/SePay/Cloudinary theo .env.example; đừng đưa secret vào Git. Không dùng database thật để chạy integration tests.
4. npm test chạy toàn bộ bộ kiểm thử. npm run test:manager chạy nhóm mới. Bộ test mặc định tạo MongoMemoryReplSet; TEST_MONGODB_URI chỉ dành cho DB local tên totmart_test do tests/helpers/db.js giới hạn.
5. Kiểm tra dữ liệu cũ bằng npm run migrate:merchant-ownership. Mặc định chỉ đọc và in các thay đổi đề xuất/các mục chưa xác định. Xác minh đúng chủ thương hiệu/merchant trước khi dùng --apply; phải đặt MIGRATION_CONFIRM_DATABASE bằng chính tên DB đã kiểm tra. Không suy ra chủ dựa vào tên/người admin đã tạo.
6. Migration chỉ bổ sung owner metadata và index cho quan hệ đã xác định; không đổi tiền, giá, tồn, đơn hoặc snapshot subscription. Combo có cấu phần nhiều chủ, chủ không phải merchant đang hoạt động hoặc owner mâu thuẫn sẽ giữ nguyên và báo unresolved. Kiểm tra/backup trước apply; script có compare-and-set và có thể chạy lại, không ghi đè owner đã gán.
7. Smoke test merchant A/B, tạo sản phẩm/combo/gift, quote, đăng ký nguồn retail, tồn và quyền. Kiểm tra upload Cloudinary thật trên staging với ảnh thử; test hiện tại chỉ mock dịch vụ ngoài cho lỗi upload/cleanup.
8. Áp dụng bản vá FE companion nếu muốn dùng nút xử lý đơn và đối soát COD. Không chép gói hardening trước đó lên cleaned; gói đó cần prerequisite khác.

## FE companion và phần còn lại

Bản vá companion riêng sửa màn manager orders, hàm gọi status, helper đọc allowedTransitions, nối busy guard và bổ sung action admin đối soát COD đã delivered nhưng pending. Không đổi thiết kế toàn site, không ghép orderModel còn thiếu của gói hardening. Nó vẫn chạy theo nguyên tắc backend quyết định quyền, UI không tự đoán.

Các việc FE còn độc lập với cập nhật BE này:

- Đổi các route công khai/menu sang /subscription, /box, /gift và thêm menu/trang admin Gift. Backend đã có API, không thể tạo route Next.js chỉ bằng thay Express.
- Profile phải đọc addresses, chuẩn hóa trường address/city và hoàn thiện thêm địa chỉ checkout; truyền keyword tìm kiếm đúng.
- Hoàn thiện attempt checkout khi mất phản hồi và storage/version recovery như báo cáo audit trước. Server vẫn có idempotency theo key; không thể tự nhận ra hai key khác nhau là cùng ý định mua.
- UI phải hiển thị policy/amenities và các khoản tiền đúng quote; phí ship do khách trả trực tiếp cho bên giao hàng, không nằm trong tiền đơn mới; dữ liệu lịch sử không tính lại.
- FE subscription validator hiện cho phép giảm 100%; backend từ chối vì gói trả trước cần tổng dương. Cần đồng bộ validation UI.
- Chưa chụp/kiểm tra browser desktop/mobile hoặc thử courier/SePay/Cloudinary thật. Không coi compile/test server là nghiệm thu giao diện hay dòng tiền production.

## Tài liệu

- MERCHANT-OPERATING-MODEL.md: lựa chọn quyền và các đánh đổi.
- MANAGER-API-CONTRACT.md: endpoint/DTO/quy tắc cụ thể.
- Log kiểm chứng thực chạy kèm bộ bàn giao bên ngoài source.
