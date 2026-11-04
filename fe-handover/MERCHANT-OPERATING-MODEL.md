# Mô hình vận hành merchant — quyết định ngày 17/10/2026

## Quyết định

Cho merchant vận hành **đơn thuộc chính merchant đó**, nhưng tách vận hành giao hàng khỏi quyền xác nhận tiền. Đây là quyền có giới hạn, không phải cấp lại vai trò admin.

- COD: pending → processing → shipped → delivered. Bước cuối là merchant báo đã giao; paymentStatus vẫn pending, codCollectionStatus = pending_review. Admin đối chiếu tiền rồi dùng action tài chính riêng để chuyển paid/confirmed.
- Online: chưa paid hoặc chưa giữ được tồn kho thì không cho xuất/giao. Sau khi hệ thống xác nhận thanh toán và giữ hàng: processing → shipped → delivered.
- Merchant không hủy/hoàn tiền, phân bổ giao dịch, tự sửa paymentStatus, tổng tiền hoặc kho đã trừ của đơn. Không chuyển ngược, bỏ bước hoặc sửa đơn của merchant khác.
- Subscription fulfillment định kỳ vẫn đi qua scheduler và quy trình admin hiện có; quyền cập nhật đơn sản phẩm không tự mở rộng sang hoàn tiền/hủy gói hay xử lý lượt giao định kỳ.

## Vì sao chọn phương án này?

**Trách nhiệm:** merchant biết hàng đã chuẩn bị và đã bàn giao; để admin bấm mọi bước tạo thông tin chậm, trách nhiệm không gắn người thao tác thật.

**Tốc độ:** merchant tự tiến hành công việc thuộc mình; admin tập trung ngoại lệ, quyền và đối soát. Nếu merchant chỉ xem, mỗi lần xác nhận/giao đều cần một vòng phối hợp khác.

**An toàn tiền:** báo giao COD không chứng minh nền tảng đã nhận tiền. Kể cả người bán trực tiếp thu tiền, vẫn phải đối chiếu trước khi ghi nhận thanh toán hệ thống. Không coi lời báo của merchant là bằng chứng ngân hàng/courier độc lập.

**Tính nhất quán:** status trả lời “hàng đang ở đâu”; paymentStatus trả lời “tiền đã được hệ thống xác nhận chưa”. delivered + pending là trạng thái hợp lệ của COD chờ đối soát, không phải mâu thuẫn. Backend/FE phải trình bày cả hai.

**Đa cửa hàng:** chỉ truy vấn bằng merchantId lưu trên đơn tại thời điểm tạo; không dựa ID merchant gửi từ trình duyệt hoặc suy ra lại từ chủ thương hiệu hôm nay. Một merchant không xem/sửa phần đơn của cửa hàng khác, không hủy cả checkout có nhiều người bán.

**Truy vết và tranh chấp:** lưu actor, thời điểm, trạng thái, note và trackingReference nếu có; optimistic concurrency và transaction khóa cùng checkout với webhook/hủy đơn. Merchant có thể khai sai tiến độ, nên báo đã giao là tuyên bố có tác giả; chính sách xử lý tranh chấp và bằng chứng courier cần quy trình vận hành riêng.

## So sánh ba lựa chọn

- **Chỉ xem:** phù hợp giai đoạn admin tự đóng/giao mọi đơn, ít cửa hàng và cần duyệt tập trung. Đơn giản nhưng admin thành điểm nghẽn. Không phù hợp nếu merchant tự chịu trách nhiệm fulfillment.
- **Toàn quyền tương tự admin:** nhanh trong thao tác nhưng trộn logistics với xác nhận tiền, hủy/hoàn tiền và tài sản cửa hàng khác. Không chọn.
- **Quyền vận hành giới hạn:** lựa chọn đã triển khai. Merchant làm phần việc của mình, hệ thống/admin kiểm soát tiền và ngoại lệ. Cần UI rõ hai trạng thái và hàng đợi đối soát.

## Phạm vi được triển khai

Đã triển khai state machine trên Order sản phẩm, quyền theo merchantId, allowedTransitions do server trả, COD chờ đối soát, retry không thêm lịch sử trùng, audit actor và transaction đồng bộ với checkout. API admin xác nhận COD hỗ trợ đơn đã được merchant báo delivered.

Không tự động chuyển tiền, xác nhận thu tiền theo lời merchant, thay đổi phí vận chuyển hiện tại, sửa sổ đối soát hoặc dữ liệu lịch sử production. Không bổ sung courier webhook, bằng chứng giao hàng độc lập hoặc quy trình tranh chấp đầy đủ trong đợt này.
