# Mongo disconnect — evidence trước khi sửa BE

HEAD 62bbb6001728523bf04654bf4aa952f30d99e738; image sha256:dad5994b78303938bfee10b714c8f8b70358c91b83726446d1a4df4e2eea5032. Docker Engine 29.9.1; driver MongoDB6.20.0, Mongoose8.24.5, Node image24.22.0. Các sửa BE từ đợt trước được giữ nguyên. Hash toàn src trước/sau không đổi; không build lại image, commit, migration, FE hoặc seal.

Hai kịch bản deadline checkout45s/240s, mỗi kịch bản3 lần; hai backend production/staging cùng image. Mỗi lần một network disconnect trên Mongo mới có UUID, SSE/pre-fault/readiness barrier; cửa sổ fault thực tế ít nhất150s, rồi snapshot ngay sau reconnect và sau hơn130s. Hai chuỗi request chạy song song để cả hai checkout đều bắt đầu trong outage; giữ thứ tự health → live → login → checkout trong từng backend. Sau quan sát, retry cùng key/body qua cả hai backend, rồi seed giỏ mới cho một lần mua độc lập với key mới và replay lại key cũ.

Runner evidence exit1; consistency pass6/fail0; availability pass1/fail5; skip0/not-run0. Availability giữ nguyên kỳ vọng503 trong outage; response201 sau reconnect được ghi là actual outcome và không đổi assertion để làm xanh.

- 45s #1: staging 503 / 5.038s / có X-Request-Id; production 503 / 18.577s / có X-Request-Id. Consistency PASS, late snapshot không đổi, cleanup exit0.
- 45s #2: production 503 / 31.150s / có X-Request-Id; staging CLIENT TIMEOUT / 45.004s / chưa nhận header; serverRequestId có trong JSON. Consistency PASS, late snapshot có thay đổi, cleanup exit0.
- 45s #3: production 503 / 28.465s / có X-Request-Id; staging CLIENT TIMEOUT / 45.002s / chưa nhận header; serverRequestId có trong JSON. Consistency PASS, late snapshot có thay đổi, cleanup exit0.
- 240s #1: staging 201 / 160.392s / có X-Request-Id; production 201 / 144.339s / có X-Request-Id. Consistency PASS, late snapshot có thay đổi, cleanup exit0.
- 240s #2: staging 201 / 161.180s / có X-Request-Id; production 201 / 161.184s / có X-Request-Id. Consistency PASS, late snapshot có thay đổi, cleanup exit0.
- 240s #3: production 503 / 29.329s / có X-Request-Id; staging 201 / 159.798s / có X-Request-Id. Consistency PASS, late snapshot có thay đổi, cleanup exit0.

## Phân loại và đường code

**Lỗi BE availability (ưu tiên P1 trước FE), không phải lỗi môi trường/harness.** Lần45s có client_timeout rõ ràng, code FIXTURE_CLIENT_DEADLINE, deadline45000ms; không gọi là response thiếu requestId vì client chưa nhận HTTP header. Trace fixture nối request đó với requestId backend và log đã lọc. Các lần240s cho thấy response thật có thể chờ khoảng144–161s (xem số chính xác từng lần phía trên).

Route POST /api/checkout/check-out → checkoutLimiter → authMiddleware.authenticate → User.findById(decoded.userId), sau đó AuthSession.exists → validation/customer policy → checkOutController.checkOut. Query treo quan sát được là User.findOne (findById dịch thành findOne), ngoài transaction, timeoutMS/maxTimeMS chưa đặt. Connection được check out và lệnh find/users đã bắt đầu; thời gian chờ dài không nằm ở pool queue hoặc vòng retry withTransaction. Backend tiếp tục sau khi client đã bỏ chờ.

Runtime cả hai backend: serverSelectionTimeoutMS5000, socketTimeoutMS0, waitQueueTimeoutMS0, connectTimeoutMS30000, maxPoolSize20, retryReads/retryWrites=true, client timeoutMS=null. 5000ms chọn server không giới hạn I/O của lệnh đã gửi qua socket. Login dùng userIdentityService.findForAuthentication có timeoutMS5000 nên trả503 khoảng5s trong cùng outage. Trace và code đối chiếu nằm trong observer.json, requests.json và input-manifest.json.

Sau auth: checkOutController.checkOut gọi replay → checkoutAttemptService.prepare (mongoose.connection.transaction, bên trong Mongoose gọi session.withTransaction) → session.withTransaction cho create commerce. Source hiện không truyền timeoutMS/maxCommitTimeMS vào hai transaction này; command commit quan sát không có maxTimeMS. Trong request treo, transaction commerce chỉ bắt đầu sau khi auth read kết thúc, thường sau reconnect. Không có bằng chứng vòng retry transaction gây phần chờ trước đó. Driver sessions.js có cửa sổ retry120s, không phải HTTP deadline hay timer bao trùm mọi await. maxCommitTimeMS không xử lý auth read trước transaction; maxTimeMS phía server không tự giới hạn một TCP peer im lặng.

Không gọi đây là UnknownTransactionCommitResult server-injected hoặc mất ACK commit thật. Đây là client timeout/response chậm, rồi request đã nhận có thể tiếp tục ghi sau reconnect.

## Snapshot và invariant

Mỗi thư mục lần chạy có setup.json (before), snapshot-reconnected.json, snapshot-delayed.json, recover.json (recovered/normal). Snapshot đọc trong transaction readConcern=snapshot trên DB có marker UUID. Đã chụp stock, coupon, Order, Checkout, CheckoutAttempt/idempotency, PaymentEvent/Allocation/Audit/Refund, User phiên bản và AuthSession (sid đã hash; không đọc/xuất refreshHash, password, token). Key idempotency xuất AES-256-GCM; khóa giải mã chỉ nằm trong tmpfs fixture và bị hủy cùng container. Body response chỉ xuất envelope allowlist; success data được biểu diễn bằng dataHash, không ghi token/ticket/PII.

Có commit muộn ở một số lần: snapshot ngay reconnect chưa có checkout, snapshot +130s đã có một checkout/đơn và stock99. Đây là một nghĩa vụ của request cũ, được báo rõ; không tuyên bố no-late-effect. Replay cùng key/body trả cùng kết quả, vẫn một checkout/Order/attempt created/stock99; request key mới sau khi tạo giỏ fixture mới làm thành hai checkout/Order, stock98; replay key cũ không tạo thêm. Hash attempt/checkout và kết quả201 outage/replay khớp. Session không đổi. Chưa phát hiện mất/nhân đôi tồn kho hoặc nghĩa vụ tài chính trong sáu lần đo.

Phạm vi đúng scenario cũ là COD chưa thu tiền, không dùng coupon: coupon collection rỗng, receipt/allocation/refund bằng0 là trạng thái hợp lệ. Không suy ra đã kiểm dòng tiền online, coupon redemption hay worker reconciliation từ các số0 này. Các snapshot có đủ collection để phát hiện phát sinh ngoài dự kiến.

## Harness đã sửa, không đổi source BE

fault-client thu riêng từng outcome bằng try/catch, ghi begin/end/duration/status hoặc timeout/transport/parse và body redact, chỉ assert sau khi thu hết. faults.js luôn kiểm readiness/recovery/snapshot/replay trong finally sau reconnect, lưu observe và recovery riêng. Runner diagnostic ghi journal mọi request kể cả client bỏ chờ; không còn trạng thái “thiếu outcome HTTP”. Probe metadata HTTP/query/driver chỉ bật monitorCommands và bọc quan sát, không đổi timeout/session/transaction option. Mọi giá trị requestId từ server thật; trace fixture chỉ dùng nối log, không giả TLS/proxy.

Setup thử đầu tiên chưa gây fault: đọc version ở root mongodb/package.json báo MODULE_NOT_FOUND; probe xác minh driver production nằm dưới Mongoose. Sửa createRequire(require.resolve(mongoose)); assertion/timeout không đổi. Lịch sử ở setup-resolution.json/module-probe.json, cleanup0; không tính setup này vào sáu lần đo.

Kiểm integrity/cleanup: exit0, 51 container/network do lượt này tạo đã absent theo exact ID; inventory container/image gốc và bốn file lịch sử A khớp hash. Candidate image giữ nguyên. Bảng route tổng hợp: [route-summary.csv](../artifacts/round-b/mongo-disconnect/dc14be58-f151-4d65-b356-1261787ab3e8/route-summary.csv); từng request, key mã hóa, timing, status/X-Request-Id: [requests-complete.csv](../artifacts/round-b/mongo-disconnect/dc14be58-f151-4d65-b356-1261787ab3e8/requests-complete.csv). Body redact, log correlated và query events: [requests-complete.json](../artifacts/round-b/mongo-disconnect/dc14be58-f151-4d65-b356-1261787ab3e8/requests-complete.json). SSE duration là vòng đời stream, xem timeToHeadersMs để phân biệt thời gian nhận header. Internal readiness chỉ có server observation được gắn nhãn riêng, không giả là client đã nhận header.

## Phương án cần owner chọn, chưa triển khai

- **A — CSOT theo từng read auth User/Session, ví dụ5000ms (đề xuất).** Ưu: sửa đúng điểm treo trước transaction, fail503 hữu hạn, giữ DB role/active/tokenVersion/sid/revocation và không đổi callback/commit/retry commerce. Hai read có thể cộng thời gian; chưa phải budget toàn route hoặc bảo đảm mọi Mongo read/worker. Slow DB có thể tạo503 sớm hơn; cần test đỏ I/O im lặng cho cả hai read. Không tạo thêm commit-unknown ở bước auth vì chưa có write/transaction commerce.
- **B — Budget CSOT riêng cho toàn checkout, gồm prepare/transaction.** Ưu: bao phủ cả chờ sau auth. Nhược: phạm vi rộng, ảnh hưởng retry/backoff/transaction; timeout quanh commit có thể chưa biết kết quả. Phải giữ key/result recovery, không coi timeout là rollback/cho key mới; cần thêm test đỏ commit-uncertainty và regression tiền/kho trước sửa.
- **C — Socket/pool timeout ở MongoClient.** Ưu: giới hạn I/O im lặng/pool trên nhiều lệnh. Nhược: tác động mọi route/worker, có thể cắt tác vụ hợp lệ; socket timeout là timeout I/O, không phải total request budget. Timeout khi chờ ACK ghi/commit có thể tạo kết quả chưa rõ. Cần chọn ngưỡng theo tải và kiểm regression rộng. Không tự thêm timeout toàn cục.

Lệnh chất lượng sau các sửa harness: npm run lint / format:check / validate:api đều exit0; không có violation mới, giữ19 lint debt cũ. File quality.json lưu riêng từng exit code. Adapter bổ sung mã lỗi deadline/parse và giữ status/requestId khi parse lỗi; đây là bổ sung metadata cho nhánh lỗi harness, không đổi status/assertion. Các file chuyển vào container của từng lần có SHA256 riêng trong resource journal; các sửa metadata cuối lượt không được dùng để viết lại outcome lịch sử.

Chờ owner chọn A/B/C và phạm vi/ngưỡng rồi gõ “tiếp”. Chưa sửa BE theo phương án nào. PHASE6 còn lại (worker/fault khác), regression B01 HTTP/full và seal vẫn **NOT-RUN**. Không đổi contract/claims/route, unique index, fencing, tombstone hoặc DB revocation.
