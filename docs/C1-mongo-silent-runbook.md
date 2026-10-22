# Mongo im lặng giữa transaction — runbook C1

Phạm vi: request mua hàng đã vào transaction/commit, TCP không đóng. B-A1-AV01 là P2 còn mở được owner chấp nhận có điều kiện; phải đóng trước staging người dùng thật/mở bán. Auth và A1 ngoài transaction vẫn giữ budget từng read 5s. Cửa sổ retry khoảng 120s không phải hard deadline của I/O. Runbook này chưa được thực hiện trên deployment thật.

1. Xác nhận requestId, thời điểm, phiên bản backend, readiness và kết nối Mongo từ telemetry được phép. Không thu body, JWT, cookie, connection credential hoặc thông tin khách vào log sự cố. Phân biệt Mongo chậm/im lặng với Redis limiter hoặc edge timeout; không suy từ 503 rằng transaction đã rollback.
2. Platform/on-call chặn admission mua mới ở edge và drain từng backend theo cơ chế deployment đã được owner duyệt. Giữ đường lookup/replay phục hồi khi hạ tầng đủ khỏe. Deadline edge, ngưỡng p99/in-flight/readiness và người trực còn cần owner chốt; không tự dùng số timeout fixture làm SLO. SIGTERM hiện có force-exit sau 10s, không bảo đảm transaction đã giải quyết trước khi process thoát. Không restart đồng loạt để thử chữa DB.
3. Giữ nguyên authenticated user/kind/key/hash và serialized body đã lưu. Create/prepare/terminate trả 5xx/503/timeout đều là **kết quả chưa rõ**. Khi Mongo phục hồi, lookup rồi resolve/replay đúng reference qua contract hiện hành. Chưa có hash thì retry prepare/terminate-with-body đúng path/body. Chỉ restart recovery sau `invalidated` + `canRestart:true`; `created` phải khôi phục result cũ. Ca code91: commit thật, trả503, replay201, một nghĩa vụ.
4. DB/platform xác minh PRIMARY, readiness ổn định và áp lực pool/latency đã giảm; đối soát read-only bên dưới trước khi mở lại admission từng bước. Nếu phát hiện nghĩa vụ mất/trùng, stock âm, sai tiền hoặc ownership đổi ngoài ý muốn: dừng mở traffic, giữ evidence và chuyển P0/P1 để điều tra. Không force commit/abort, xóa attempt/tombstone, mở key mới tự động hoặc sửa cờ paid/stock/coupon bằng tay.
5. Đơn đã tạo được hủy/hoàn qua API và reconciliation workflow hiện có, với idempotency key và bằng chứng tài chính đúng contract. Pending refund chưa phải đã chuyển tiền. Finance đối chiếu receipt/allocation/refund; không gửi ngân hàng hoặc provider để thử. Sau sự cố lưu timeline đã lọc, kết quả replay, backlog và quyết định mở lại của owner; xem lại acceptance sau DR03/DR05 và phase tải.

## Truy vấn đối soát chỉ đọc

Operator chọn DB và quyền read-only trên môi trường đã được duyệt; không tự chạy trên dữ liệu thật trong C1. Truy vấn trả số lượng, không xuất user/body/key/payment reference. Mốc 15 phút là ngưỡng điều tra đề xuất, chưa là SLO. Không có write, `$out`, `$merge`, xóa hoặc sửa index.

```javascript
const cutoff = new Date(Date.now() - 15 * 60 * 1000);
db.checkoutattempts.aggregate([
  { $match: { state: 'processing', updatedAt: { $lt: cutoff } } },
  { $count: 'count' },
  { $set: { signal: 'attempt_processing_over_15m' } },
  { $unionWith: { coll: 'orders', pipeline: [
    { $match: { paymentMethod: 'online', $or: [
      { paymentCode: { $exists: false } }, { paymentCode: null }, { paymentCode: '' }
    ] } },
    { $count: 'count' }, { $set: { signal: 'online_order_missing_payment_code' } }
  ] } },
  { $unionWith: { coll: 'products', pipeline: [
    { $match: { stock: { $lt: 0 } } }, { $count: 'count' },
    { $set: { signal: 'negative_product_stock' } }
  ] } },
  { $unionWith: { coll: 'boxes', pipeline: [
    { $match: { stock: { $lt: 0 } } }, { $count: 'count' },
    { $set: { signal: 'negative_box_stock' } }
  ] } },
  { $unionWith: { coll: 'coupons', pipeline: [
    { $match: { $or: [ { usedCount: { $lt: 0 } },
      { $expr: { $and: [ { $ne: ['$usageLimit', null] },
        { $gt: ['$usedCount', '$usageLimit'] } ] } }
    ] } }, { $count: 'count' }, { $set: { signal: 'coupon_counter_out_of_bounds' } }
  ] } },
  { $unionWith: { coll: 'paymentevents', pipeline: [
    { $match: { paymentLedgerVersion: 2, disposition: 'unallocated',
      createdAt: { $lt: cutoff } } },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$transferAmount' } } },
    { $project: { _id: 0, signal: { $literal: 'receipt_unallocated_over_15m' }, count: 1, amount: 1 } }
  ] } }
], { readConcern: { level: 'majority' }, maxTimeMS: 5000, allowDiskUse: false }).toArray();
```

Không có row nghĩa là nhánh đó không tìm được ứng viên; timeout là chưa biết, không phải zero. Đây là nhiều read majority, không phải snapshot đồng thời toàn DB. Unallocated receipt có thể hợp lệ khi chưa match; stock/coupon trong bounds chưa chứng minh bảo toàn lịch sử. Khi cần đối soát sâu, dùng Checkout/Order snapshot, stockDeducted, couponReleased, PaymentEvent/Allocation/Refund/Audit và version theo B06; không suy nghĩa vụ từ catalog hiện tại. Query lớn có thể cần review explain/index; không thêm index trong sự cố để ép chạy được.
