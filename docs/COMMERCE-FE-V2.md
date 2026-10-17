# Đồng bộ FE và phí giao hàng — 17/10/2026

Khách trả phí vận chuyển trực tiếp cho bên giao hàng. TotMart không thu phí đó trong tiền COD/chuyển khoản, không ghi khoản thu hộ ship vào doanh thu hoặc khoản admin đối soát. Trước mỗi lần giao, người vận hành cần thông báo và thống nhất phí với khách. Gói tháng cũng áp dụng riêng từng lần giao. Chưa tích hợp báo giá hoặc đối soát phí với hãng vận chuyển.

Đơn mới: `shippingFee = 0`, `shippingPayment = customer_to_carrier`, policy `commerce-v2-delivery-separate`. `/api/commerce-policy` có `shipping: {mode: separate, includedInCheckout: false}` tương thích định dạng quan sát được trên staging. Quote có thêm shippingPayment/shippingFeeIncluded; Order, Checkout và subscription mới lưu phương thức ship trong snapshot. Dữ liệu cũ không bị tính lại; thiếu shippingPayment phải được hiểu theo lịch sử, không mặc định chuyển quyền thu tiền.

Địa chỉ chuẩn là `addresses`. Thêm fullName tùy chọn trong địa chỉ, delivery snapshot ưu tiên tên người nhận rồi mới fallback tên tài khoản cho dữ liệu cũ. Checkout FE lưu địa chỉ bằng API rồi chỉ gửi ID thật server trả về. Không tạo alias tên viết sai.

FE đầy đủ được xây trên impeccable-cleaned + order companion. Gộp các phần hardening dùng được: WorkspaceShell, AccountMenu, shortcut, initials Unicode, điều hướng admin, kiểm tra vệ sinh repo, tài liệu. OrdersWorkspace được tích hợp lại với bộ lọc và meta BE, giữ expectedStatus và allowedTransitions; không chép file phụ thuộc orderModel.mjs bị thiếu.

Đã thêm /subscription, /box, /gift và /admin-gifts. Gift có tạo/sửa/ngừng bán và chính sách bậc giảm/tiện ích, giữ chủ của combo nguồn. Subscription hỗ trợ nguồn combo/hàng lẻ qua template đã tạo ở manager. Validation admin và merchant đều yêu cầu giảm dưới 100%, giá cuối cùng vẫn do server kiểm tra phải dương.

Phục hồi mua hàng: giữ nguyên payload/key của yêu cầu chưa rõ kết quả, không đồng bộ lại giỏ đã bị tiêu thụ, trả phiên bản cart mới khi sync 409. Lưu trữ trình duyệt thất bại không chặn mua hàng, có bộ nhớ trong tab. Nếu storage bị chặn và tab đóng/refresh thì bộ nhớ này mất; phải kiểm tra lịch sử đơn trước khi tạo yêu cầu mới. URL mã đơn được cập nhật trước lần gọi lấy QR tiếp theo.

## Dữ liệu legacy và staging

Chạy `npm run migrate:merchant-ownership` trên môi trường/DB được chỉ định, mặc định chỉ đọc. Xem từng `unresolved`; brand do admin tạo không xác định chủ merchant. Combo nhiều chủ cần người vận hành phân loại. Không chạy --apply khi chưa xác minh, backup và đặt MIGRATION_CONFIRM_DATABASE đúng DB. Phiên cập nhật này chưa đọc hoặc sửa DB staging/production.

`node scripts/check-staging-commerce.js` chỉ kiểm tra công khai, không tạo đơn hoặc webhook. Public preflight đạt không có nghĩa toàn bộ hệ thống đạt nghiệm thu. Cần tài khoản thử nghiệm riêng để kiểm tra khách/merchant/admin, cookie qua Vercel→Render, upload thật, webhook có kiểm soát và đối soát/tranh chấp.

Staging quan sát ngày 17/10/2026: BE health ready, policy đã là delivery-separate; FE /subscription, /box, /gift trả 404; truy vấn products?search=totmart-no-match-20261017 vẫn hiện hai sản phẩm. Các quan sát này thuộc bản đang deploy, không phải kết quả chạy source local mới. Không sao chép đè source staging đang thay đổi mà chưa xem diff.

## Áp dụng bản bàn giao

1. Dùng FE đầy đủ `TotMart-FE-commerce-v2.zip` và BE đầy đủ `TotMartAPI-commerce-v2.zip`, hoặc xem/apply hai patch trên đúng nền đã ghi trong manifest. Đây là source đầy đủ, không phải overlay sáu file trước đó. Patch đã qua git apply --check trên đúng nền; source hiện tại khác nền cần review diff trước.
2. Tạo Git checkpoint ở hai thư mục đích. Script robocopy trong bộ kit chỉ sao chép, không xóa file dư, không thay .env/Git/dependencies; script chưa được thực thi. Chạy npm ci riêng ở FE và BE. Không đóng gói node_modules hoặc .next.
3. Cấu hình FE deployment: API_URL=https://totmartapi-1.onrender.com/api ở phía server, browser dùng /api. BE cấu hình FRONTEND_URL/CORS_ORIGINS đúng origin staging đã cấp. Giữ secret trên hệ thống triển khai, không chép qua ZIP/chat.
4. Sau khi deploy đúng commit, chạy public preflight; kiểm tra cả ba route mới hết 404. Dùng tài khoản thử nghiệm: địa chỉ mới, search không khớp, checkout COD/QR, mất phản hồi/thử lại, Gift ba hộp có giảm và phí tiện ích, subscription nguồn retail/combo, phân quyền merchant A/B, admin Gift và COD delivered/pending → đối soát.
5. Chạy báo cáo ownership mặc định chỉ đọc bằng kết nối DB staging được cấp trong môi trường an toàn; xác minh từng unresolved trước khi quyết định migration. Chưa có quyền DB nên bản bàn giao không kết luận dữ liệu legacy thật đã đúng.

Kiểm tra local: 39 suite/313 test BE; 86 test FE, lint và build đạt; 38 kiểm tra hợp đồng FE–BE đạt. Hai patch áp thử trên đúng source nền đạt. Chạy test với MongoDB replica set local tạm, không phải database staging. Upload có kiểm tra mock; chưa thử dịch vụ thật/webhook staging. Không có khoản tiền thật nào được chuyển.

Cơ chế duyệt tự động từ chối lệnh khởi chạy Next.js local do yêu cầu phê duyệt không được phép trong phiên. Vì vậy chưa xác minh UI bản mới bằng trình duyệt; chỉ kiểm tra công khai trên bản staging hiện hữu. Không coi kết quả build hoặc test API là nghiệm thu giao diện.
