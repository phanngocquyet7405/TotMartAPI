# TotMart — nghiệm thu và vận hành

Current local operational evidence: [B07 verification](docs/B07-verification.md), [incident/backup/migration runbook](docs/B07-operations-runbook.md) and [review-only release plan](docs/B07-release-plan.md). Earlier tool/permission/backup notes below are historical; they do not authorize using an existing environment or prove current checks.

## Bổ sung kiểm chứng 2026-10-19

Hợp đồng mới và thứ tự drain/migration/deploy/rollback nằm ở đầu [checkout-attempt-contract.md](docs/checkout-attempt-contract.md); kết quả từng lượt tại [be-handoff-verification.md](docs/be-handoff-verification.md). Không dùng kết quả ngày 18 thay cho trạng thái hiện tại.

Attempt giữ vĩnh viễn, không TTL. Quota attempt: IP 300/phút, user 120/phút; production dùng namespace Redis chung. Admission tối đa 10.000 reference/user được serialize bằng transaction, bao gồm legacy và tombstone; cảnh báo từ 8.000. `ATTEMPT_CAPACITY_REACHED` không cấp quyền dùng key mới. Không xóa record để “giải phóng”; điều tra abuse, sizing và chính sách lưu trữ bảo toàn fencing/replay trước khi sửa ngưỡng.

Admin operations summary thêm tổng attempt, tăng trưởng 24 giờ, số user tới ngưỡng; alert tăng trưởng >=100.000/ngày, webhook retry quá 15 phút, outbox quá 15 phút và refund pending quá 24 giờ. Summary có aggregation toàn collection: chạy định kỳ thưa, đo latency; không dùng làm probe mỗi giây. Thu thập time series dung lượng collection/index và tốc độ tăng, cảnh báo độ lệch baseline phù hợp traffic staging. Đây là endpoint cung cấp tín hiệu; cần nối hệ thống giám sát của tổ chức trước production. Chưa có bằng chứng thông báo bên ngoài được giao, và đợt này không gửi tin cho ai.

Redis có deadline ứng dụng 2,5 giây cho eval/del/publish/set/GETDEL; probe PING cả client/subscriber mỗi giây, socket timeout 5 giây và giới hạn queue 1.000. Không chỉ dựa vào command queue timeout của driver: lệnh đã ghi vào socket im lặng cũng phải kết thúc chờ. Khi deadline lỗi: readiness false, đóng stream, security request fail closed; worker giữ outbox để retry. Lệnh đã gửi có thể hoàn thành muộn sau timeout: không suy ra nó chưa chạy, chấp nhận quota bị tính dư/ticket mất hiệu lực thay vì bỏ bảo mật; publish có thể trùng và consumer phải idempotent. Không dùng deadline này để suy luận kết quả transaction MongoDB.

Diễn tập riêng, không nạp `.env`, không nhận URI database thật:

```powershell
node scripts/drill-backup-disposable.js
```

Script cần Docker và image `mongo:7.0`, tự tạo container Mongo replica set với port loopback ngẫu nhiên, seed 6 collection giả, dùng MongoDB Database Tools trong container để archive gzip/restore vào database mới. Kiểm tra counts, toàn bộ document/index, quan hệ Order/Checkout và conservation allocation/receipt/refund; chỉ xóa container tên ngẫu nhiên chính script tạo. Không thay thế backup production, mã hóa archive, retention, PITR, tải lớn hoặc việc kiểm chứng các script backup ngoài repo. Không dừng writer thật hoặc thao tác database thật trong drill.

Test Redis HTTP nhiều process khác với Redis primitives:

```powershell
$env:TEST_REDIS_URL='redis://127.0.0.1:16380'
$env:TEST_REDIS_CONTAINER='totmart-session-20261019-redis'
$env:TEST_MONGODB_URI=''
$env:MONGOMS_VERSION='7.0.14'
$env:CI='true'
$env:LOG_LEVEL='silent'
npm test -- --silent
```

Phải tạo Redis disposable có tên prefix `totmart-session-...-redis` và port tương ứng trước khi chạy. Suite sẽ stop/start và pause/unpause **đúng container đó**, nên tuyệt đối không trỏ tới Redis dùng chung hoặc staging. Mongo test mặc định tự tạo replica set một member; không dùng URI ứng dụng. Hai process HTTP chỉ chạy security outbox worker, không scheduler gửi email/SMS hay ngân hàng thật. Kiểm chứng reconnect/blackhole không chứng minh Sentinel/Cluster, multi-node primary failover hoặc unknown commit-result thật.

## Môi trường kiểm tra đã chuẩn bị

MongoDB replica set rs0 dùng cổng 27018, Redis cổng 6380. Không chuyển đổi hoặc xóa MongoDB standalone đang dùng ở 27017. Bộ kiểm thử chỉ nhận database localhost tên `totmart_test`; dữ liệu nghiệm thu trình duyệt ở `totmart_acceptance` tách riêng.

Khởi chạy hạ tầng trong PowerShell bên ngoài Codex:

```powershell
& "C:/Users/Admin/Documents/Codex/2026-10-14/github-plugin-github-openai-curated-remote-2/outputs/Start-TotMart-Acceptance.ps1"
```

Chạy toàn bộ test trong thư mục Backend:

```powershell
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27018/totmart_test?replicaSet=rs0&directConnection=true'
$env:TEST_REDIS_URL='redis://127.0.0.1:6380'
$env:LOG_LEVEL='silent'
npm test
```

`TEST_MONGODB_URI` dùng dịch vụ đã chạy sẵn thay vì MongoMemoryReplSet tự tạo mongod. Đây là cơ chế được bộ test hỗ trợ, không cần tắt sandbox. Đừng đặt URI production vào biến này: test xóa dữ liệu thử sau mỗi bài.

## Tài khoản nghiệm thu trình duyệt

Backend thử chạy bằng `node scripts/acceptance-server.js`, chỉ cho database `totmart_acceptance` ở 27018. Script tạo fixture nếu chưa có; không xóa dữ liệu hiện có. Tài khoản: `admin@totmart-test.example.com`, `merchant1@totmart-test.example.com`, `merchant2@totmart-test.example.com`, `customer@totmart-test.example.com`. Mật khẩu mặc định chỉ dùng cho thử nghiệm: `TotMart-Test-2026!`; có thể đặt `ACCEPTANCE_PASSWORD` trước lần tạo đầu tiên.

Backend này dùng khóa thử, không gửi giao dịch SePay thật và không chạy scheduler nền. Nó phục vụ nghiệm thu giao diện/API, không thay thế kiểm tra server production cùng các scheduler và dịch vụ thực.

Frontend thử mở bằng `Start-TotMart-Frontend.ps1`; giữ cửa sổ PowerShell mở. Script dùng bản đã build trong workspace và API localhost, không phải cấu hình deploy.

Nghiệm thu theo thứ tự:

1. Merchant 1 chỉ thấy thương hiệu, sản phẩm, combo, gift, gói và đơn của mình; không thấy sản phẩm merchant 2, không vào admin.
2. Merchant 2 thực hiện cùng kiểm tra, thử URL admin và chọn tham chiếu ngoài phạm vi qua API.
3. Admin tạo thương hiệu cho merchant, sửa tên/logo mà giữ chủ; gán thương hiệu trống; thử chuyển thương hiệu có sản phẩm của chủ khác để kiểm tra lỗi 409.
4. Khách mua combo/gift, kiểm tra giá và tiện ích ở giỏ; đăng ký hàng lẻ; kiểm tra đơn và trạng thái sau thanh toán thử; hủy và kiểm tra hoàn kho/refund.

Thanh toán thật chỉ nghiệm thu khi đã có cấu hình thử của SePay và sự tham gia của chủ tài khoản ngân hàng. Webhook mô phỏng đi qua API thật không chứng minh đã chuyển tiền qua ngân hàng.

## Quy tắc chuyển chủ

- Product.ownerId là chủ trực tiếp; Brand.ownerId quản lý thương hiệu và việc chọn tham chiếu. Không tự chuyển chủ sản phẩm theo thay đổi Brand.
- Chỉ admin gán thương hiệu cho merchant hoạt động. Thương hiệu trống có thể gán. Thương hiệu có sản phẩm không thuộc merchant đích bị chặn 409.
- Đổi thương hiệu sản phẩm trong phạm vi cùng chủ được phép; đổi sang thương hiệu chủ khác bị chặn 409, kể cả admin.
- Order.merchantId, giá và cấu phần subscription đã mua giữ lịch sử. Không viết lại các nghĩa vụ đã bán để “chuyển cửa hàng”.
- Nếu doanh nghiệp cần bàn giao cửa hàng: sao lưu, đối soát công nợ, tạo catalog mới cho chủ mới hoặc xây công cụ chuyển chủ có audit riêng; không dùng raw update hàng loạt trên hệ thống đang chạy.

## Giám sát

`GET /api/home/live` kiểm tra tiến trình, `GET /api/home/health` kiểm tra readiness. Dùng `MONITOR_API_URL` rồi chạy `node scripts/monitor-health.js`; trả exit 1 khi lỗi/timeout. Có thể cấu hình dịch vụ giám sát của môi trường triển khai gọi probe mỗi phút và cảnh báo sau nhiều lần lỗi liên tiếp; script không tự gửi tin cho người khác.

`GET /api/admin/operations/health-summary` chỉ admin: trạng thái kết nối, số outbox pending quá 15 phút, số refund đang chờ. Không trả token, nội dung đơn hay dữ liệu khách. Outbox tồn đọng là tín hiệu cần xem worker/Redis/log; refund pending có thể là công việc xử lý thủ công, không tự coi là lỗi.

Khi readiness lỗi: kiểm tra MongoDB/replica set, Redis, log request ID, worker. Khi webhook lỗi: lưu event/reference đối soát, xác minh ledger rồi retry bằng cùng danh tính event; không tự sửa paymentStatus bằng raw DB. Khi outbox kẹt: sửa nguyên nhân kết nối/email, để worker retry; không xóa event tài chính.

## Backup và phục hồi

Hai script `Backup-TotMart.ps1`, `Restore-TotMart-Drill.ps1` yêu cầu MongoDB Database Tools (mongodump/mongorestore). Chưa có tools này trên máy trong lần chuẩn bị, nên không tuyên bố đã chạy backup/restore drill.

Đặt URI qua `MONGODB_BACKUP_URI` / `MONGODB_RESTORE_URI`, không chèn khóa thật vào source. Backup single database cần tạm dừng ghi hoặc dùng backup point-in-time của nhà cung cấp để bảo đảm nhất quán. Script tạo archive gzip và SHA-256. Bản sao lưu chứa dữ liệu nhạy cảm: hạn chế truy cập, mã hóa và lưu ngoài máy chạy ứng dụng theo chính sách tổ chức.

Restore drill luôn đổi namespace sang database mới `totmart_restore_drill_<timestamp>`, không ghi đè production và không dùng --drop. Sau phục hồi kiểm tra collection counts, unique indexes, tổng tiền/ledger, quan hệ Order/Checkout/Subscription. Backup chưa được coi là dùng được cho đến khi khôi phục thử và xác minh.

Trước deploy: backup, lưu bản release, chạy migration preview, kiểm tra rollback; dừng nhận giao dịch nếu migration đụng nghĩa vụ tài chính. Sau deploy: health, một giao dịch thử theo chính sách, kiểm tra webhook/ledger/outbox. Nếu lỗi cấu trúc dữ liệu: dừng ghi và phục hồi theo phương án đã thử; không rollback code mù khi schema đã đổi.

## Giới hạn quyền Codex

Trong phiên hiện tại lệnh Docker daemon và mở Next server trực tiếp gặp hạn chế quyền. Chủ máy chạy script hạ tầng/frontend bên ngoài Codex; Codex dùng kết nối tới dịch vụ thử đã mở. Không tắt firewall, sandbox hoặc cấp quyền quản trị diện rộng chỉ để chạy test. Với chính sách managed, cần quản trị viên xem cấu hình quyền theo tài liệu OpenAI chính thức.
## Session rotation and staging policy

See [refresh family state machine, retention, legacy cutover and rollback](docs/refresh-family-policy.md).
`NODE_ENV=staging` now uses production configuration validation and requires session `sid` at HTTP/SSE authentication entrypoints, with Secure cookies. Deploy all auth writers together with additive indexes; preserve the same `JWT_REFRESH_SECRET` across instances. Do not roll back to code that ignores `revokedAt`. Local proxy fixture tests do not constitute staging validation.
