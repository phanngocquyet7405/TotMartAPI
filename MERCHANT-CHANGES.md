# TotMart — bản FE và BE đã ghép

Ngày bàn giao: 14/10/2026.

## Nội dung hai ZIP

- `TotMart-FE-optimized.zip`: ứng dụng Next.js đầy đủ trong thư mục `Frontend`.
- `TotMart-BE-optimized.zip`: ứng dụng Express/MongoDB đầy đủ trong thư mục `Backend`.
- Có source, public assets, package.json, package-lock.json, cấu hình mẫu, kiểm thử và tài liệu. Không có node_modules, .next, môi trường bí mật hoặc dữ liệu production.

Đây là bản ghép từ hai ứng dụng gốc, các thay đổi manager trước đó và những phần phù hợp của totmart-delivery. Không chép đè toàn bộ gói bổ sung.

## Các phần được giữ và kết hợp

1. Manager riêng tại `/manager`; admin giữ khu vực admin. Product, Box, SubscriptionTemplate có ownerId trực tiếp, bất biến trong thao tác thông thường. Không tin role từ JWT cũ.
2. Lấy cách tách xác minh token/session thành resolveUser/attach từ gói mới. staffMiddleware chỉ là guard cho vai trò, không tự cấp quyền dữ liệu; các route admin không được mở đại trà cho merchant.
3. Viết lại merchantScope theo owner trực tiếp, bổ sung xác minh merchant, bảo vệ việc gán thương hiệu và bộ lọc sản phẩm. API manager hỗ trợ tìm kiếm, brand/category và khoảng giá; giao diện có tìm kiếm sản phẩm sau khoảng chờ 300ms.
4. Sản phẩm riêng, combo, đăng ký từ combo/hàng lẻ, gift từ combo có giảm theo số lượng và tiện ích kèm phí; đơn hàng merchant chỉ đọc theo merchantId.
5. Admin có danh sách merchant và ô chọn merchant khi tạo/sửa thương hiệu. Trang sửa tải trực tiếp thương hiệu theo ID thay vì tìm trong trang đầu của danh sách.
6. Thêm xác nhận nhận hàng: chỉ chủ đơn online đã trả tiền, đang shipped, được đổi sang delivered. Yêu cầu lặp lại khi đã delivered trả thành công. Đơn COD giữ quy trình thu tiền/xác nhận hiện có của admin.
7. Sửa parser multipart ở cập nhật combo. Sửa trang danh mục không giảm giá hai lần và luôn đưa combo vào giỏ bằng boxId/itemType box.
8. Điều hướng Combo/Hộp quà có bộ lọc khác nhau; danh mục tải đủ các trang của loại đang xem. Box nội bộ cho đăng ký hàng lẻ không xuất hiện trong danh mục mua trực tiếp.
9. Production build báo lỗi ngay khi không có API_URL hoặc NEXT_PUBLIC_API_URL. Font được phục vụ từ ứng dụng qua @fontsource, không gọi Google Fonts khi build hay khi hiển thị.
10. Bổ sung kiểm thử phù hợp với API manager hiện tại từ các kịch bản trong gói mới: quyền sở hữu, bộ lọc, multipart, merchant bị khóa, gán brand và xác nhận nhận hàng. Hai file test gốc của gói mới không được chép nguyên vì dùng mô hình quyền và endpoint khác.

## Quy tắc gán thương hiệu

Admin có thể tạo thương hiệu mới cho merchant hoặc gán một thương hiệu chưa có sản phẩm xung đột. Chỉ gán cho tài khoản role merchant đang hoạt động.

Đổi Brand.ownerId không tự chuyển Product.ownerId, combo, subscription hoặc nghĩa vụ đã bán. Khi thương hiệu có sản phẩm không thuộc chủ mới, API trả 409. Cần xử lý migration/chuyển chủ có kiểm soát trước; giao diện không âm thầm chuyển dữ liệu của merchant khác. Việc sửa tên/logo của brand mà không đổi chủ vẫn hoạt động với brand cũ của admin.

## Cài đặt

Yêu cầu Node 22 hoặc 24; MongoDB replica set; các biến Redis, Cloudinary, Brevo và SePay theo cấu hình mẫu.

Backend:

```text
cd Backend
npm ci
# Tạo .env từ .env.example và cấu hình dịch vụ
node scripts/migrate-merchant-ownership.js
# Xem báo cáo, sao lưu DB, rồi mới áp dụng:
node scripts/migrate-merchant-ownership.js --apply
npm start
```

Migration mặc định chỉ xem trước. Suy ra chủ sản phẩm từ chủ thương hiệu, combo từ toàn bộ sản phẩm cùng merchant, template từ combo và gift cùng merchant. Các mục unresolved không tự gán cho người đang đăng nhập. Với brand cũ thuộc admin và đã có sản phẩm, cần lập kế hoạch chuyển chủ trên bản sao staging; không coi migration này là lệnh chuyển mọi dữ liệu sang một merchant mới.

Frontend:

```text
cd Frontend
npm ci
# Tạo .env.local từ .env.example
# API_URL=http://localhost:3001/api cho phát triển
npm run dev
```

Khi build/deploy thực tế đặt `API_URL=https://<backend-host>/api`. Trình duyệt mặc định gọi `/api`, Next.js rewrite sang backend. URL production phải là HTTPS remote host; không dùng giá trị localhost của kiểm thử cho production.

```text
npm run build -- --webpack
npm start
```

## Trạng thái xác minh

- 110 kiểm thử backend trong 8 bộ không cần MongoDB đã qua. Phạm vi: manager, thay đổi ghép, quyền người dùng, quote/discount gift, box version, prepaid, commerce policy và upload logo.
- 40 kiểm thử frontend đã qua khi chạy trong cùng tiến trình.
- ESLint các file frontend thay đổi được kiểm tra riêng.
- Build production frontend đã thành công trên mã cuối cùng với webpack, cấu hình CI và API_URL localhost thử nghiệm. Font đã chuyển sang nội bộ.
- MongoDB integration vẫn bị lỗi spawn EPERM trong môi trường thực hiện. Không xác nhận giao dịch thực tế, Cloudinary/Brevo/Redis/SePay hoặc E2E trình duyệt.

Lệnh kiểm thử backend đã chạy:

```text
npm test -- --runTestsByPath tests/mergedMerchant.unit.test.js tests/manager.unit.test.js tests/commerceQuote.unit.test.js tests/boxDefinition.unit.test.js tests/userAuthorization.test.js tests/prepaidAndPricing.test.js tests/commercePolicy.test.js tests/brandLogoUpload.test.js
```

Lệnh kiểm thử frontend đã chạy trong môi trường hạn chế tạo tiến trình con:

```text
node --test --experimental-test-isolation=none tests/*.test.cjs
```

Trên CI có MongoDB dùng `npm test` đầy đủ trong backend, đặc biệt `manager.integration.test.js`. Cần nghiệm thu với hai merchant và một admin: gán brand, tạo/sửa sản phẩm, cập nhật combo, mua gift, đăng ký hàng lẻ, thu tiền và giao hàng.

## Giới hạn nghiệp vụ vẫn giữ

Đăng ký giao hàng mỗi tháng nhưng thu tiền trước cho kỳ 1/3/6/12 tháng; chưa tự động trích tiền mỗi tháng. Tiện ích gift được bao gồm trong mỗi hộp, chưa phải tùy chọn tiện ích rời ở checkout. Khi đã có nghĩa vụ đơn/đăng ký, hệ thống khóa chỉnh sửa cấu phần combo theo cơ chế version hiện có. Hoàn tiền và chi trả merchant cần quy trình vận hành đã thống nhất.

Hai SKILL.md của gói bổ sung được dùng làm tài liệu tham khảo, không cài vào máy và không giữ các mô tả trạng thái cũ như nguồn sự thật cho bản ghép. Không bảo đảm một kiến trúc là “tối ưu nhất” trong mọi hoàn cảnh; lựa chọn ở đây nhằm giữ tính tương thích, thống nhất quyền và sửa những lỗi đã xác minh.
