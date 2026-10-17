# Hợp đồng thống nhất — 17/10/2026

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

Redis live cần TEST_REDIS_URL trỏ Redis local cô lập; mặc định ba test này bỏ qua nếu không có dịch vụ. Docker engine của phiên chưa chạy nên chưa kiểm chứng Redis thật. Cookie production, upload thật và webhook staging cần môi trường/tài khoản thử nghiệm; không suy ra đạt chỉ từ test local.
