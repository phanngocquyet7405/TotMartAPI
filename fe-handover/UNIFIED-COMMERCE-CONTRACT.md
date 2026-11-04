# Hợp đồng thống nhất — 17/10/2026

Bổ sung session B04 (20/10/2026): production và staging đều bắt buộc sid tại HTTP/SSE; kiểm revokedAt/expiry từ DB. Refresh cho tối đa hai retry trong 30 giây khi successor còn current; ngoài chính sách thu hồi đúng family. Giữ name/email và request/response thành công hiện có. Xem [state machine và chuyển tiếp/rollback](refresh-family-policy.md), [kiểm chứng B04](B04-verification.md). Ghi chú B02 bên dưới mô tả phạm vi lịch sử trước khi mở strict policy sang staging.

Bổ sung danh tính B03 (20/10/2026): display name không còn là khóa duy nhất trong schema, nhưng index Mongo legacy chỉ được gỡ theo kế hoạch đã duyệt; email mới canonical trim/lowercase, legacy giữ exact login và fallback không mơ hồ. Password mới/reset có giới hạn 72 byte UTF-8; login legacy có thể trả cờ yêu cầu reset. Forgot provider failure trả cùng 200/body generic như email không tồn tại. Không đổi whitelist admin/profile hay scope commerce; xem [B03-verification](B03-verification.md) cho thay đổi API, migration/rollback, test và giới hạn còn lại.

Bổ sung auth B02 (20/10/2026): route dùng JWT xác thực một lần, đọc User hiện tại và kiểm session nếu JWT có sid; production bắt buộc sid, không cache auth. Đây là query xác thực, không bao gồm query nghiệp vụ. Route có ID validator trước guard kiểm ID trước role/ownership rồi mới payload. Endpoint tồn tại với ID hợp lệ: anonymous 401, sai role 403; ID sai trên request đã xác thực có thể 400 trước 403. Subpath không tồn tại trong mount có authenticate: anonymous 401, đã xác thực 404; ngoài mount auth có thể 404 ngay. Quyền owner/foreign tùy endpoint, không đồng nhất mọi trường hợp thành 403 (manager thường 404, attempt lookup foreign trả 200/unknown). Xem [phạm vi, inventory và bằng chứng B02](B02-verification.md). Không mở rộng admin override trên scope customer/merchant; checkout order-status/cancel giữ ngoại lệ admin đã có từ trước.

## Shipping

`shippingPayment=customer_to_carrier` là trường chuẩn: khách trả trực tiếp cho bên giao hàng. `shippingFee=0` trong quote/đơn mới, không cộng vào COD/QR. `shippingMode=separate` là alias tương thích với các client/test đã tồn tại, không phải cách tính giá thứ hai. Policy công khai có shipping.mode=separate và includedInCheckout=false. Đơn cũ giữ nguyên snapshot/số tiền. Phiên này không migration DB thật.

Hạn chuyển khoản chỉ áp dụng paymentMethod=online. Đơn COD không bị API trạng thái coi là hủy chỉ vì expiresAt đã qua. Merchant báo giao không xác nhận tiền. Admin mark-cod-delivered xác nhận tiền hàng của đơn con; transaction khóa checkout, cộng lại receivedAmount từ các đơn đã paid và chỉ chuyển checkout paid khi tất cả đơn con đã paid. Thử lại không ghi tiền hai lần. Phí vận chuyển ngoài hệ thống không được ghi vào receivedAmount.

## Ownership

Product.ownerId bất biến là chủ trực tiếp; dữ liệu chưa có ownerId chỉ được manager truy cập qua brand thuộc mình và còn phải qua báo cáo migration. Khi bán, ownerId đã có phải khớp Brand.ownerId; xung đột trả 409. Order.merchantId là snapshot quyết định quyền vận hành đơn, không suy lại từ brand hiện tại.

Admin tạo brand có thể chỉ định merchant đang hoạt động; GET /api/brands/merchant-options chỉ trả _id/name và chỉ dành admin. Không chỉ định thì giữ hành vi admin quản lý. PUT sửa brand chỉ chấp nhận ownerId không đổi; chuyển chủ trả 409 và phải dùng quy trình chuyển quyền/migration có xác minh. Không chuyển quyền gián tiếp bằng đổi brand sản phẩm, kể cả dữ liệu legacy chưa gán ownerId. FE khóa chọn owner khi sửa brand, cho chọn khi tạo mới.

## Orders / operations

- Merchant chỉ processing → shipped → delivered trên đơn của mình theo allowedTransitions và điều kiện thanh toán/kho; COD giao xong vẫn chờ admin đối soát.
- POST /api/orders/:id/confirm-receipt: khách xác nhận đơn của mình, online/paid/shipped. Cập nhật nguyên tử, tăng __v, ghi actor/lịch sử một lần; retry delivered trả 200. Đơn khác chủ 404, COD hoặc chưa đủ điều kiện 409. Không sửa tiền/kho hoặc trả dữ liệu nội bộ trong response.
- GET /api/admin/operations/health-summary: admin-only; databaseConnected, redisReady, số lượng refund đang chờ và outbox quá 15 phút; không chứa khách hàng hoặc khóa bí mật.

## Kiểm thử và giới hạn

Giữ toàn bộ test gốc và các test bổ sung ở source đích. Sửa mock manager theo truy vấn hiện tại thay vì giảm quyền kiểm tra. Test ownerId giả mạo yêu cầu 400 và không có write, thay vì kỳ vọng server bỏ qua rồi tạo. Bổ sung kiểm thử tích hợp xác nhận nhận hàng đồng thời, scope, quyền admin, ownership xung đột, COD chia đơn/đối soát và timeout.

Lịch sử ngày 17/10/2026: ở phiên ghi tài liệu gốc, Docker engine chưa chạy nên chưa kiểm chứng Redis thật; nhận xét “ba test bỏ qua nếu thiếu dịch vụ” chỉ mô tả snapshot test lúc đó. Không dùng đoạn lịch sử này để kết luận về source/test hiện tại. Bằng chứng mới: [B01](B01-verification.md) đã chạy Redis HTTP và full suite local không skip trên tài nguyên cô lập; [B02](B02-verification.md) ghi từng snapshot, exit code và phạm vi regression tiếp theo. Runner hiện tự cấp Redis dùng riêng, không dùng URL/credential dữ liệu chung. GitHub Actions còn chờ; cookie production, upload thật và webhook staging vẫn cần môi trường/tài khoản thử nghiệm, không suy ra đạt chỉ từ test local.
