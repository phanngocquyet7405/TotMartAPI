# Biên bản kiểm chứng bàn giao BE

Ngày kiểm chứng hiện tại: **2026-10-19**. Đã sửa implementation BE và thêm kiểm chứng; không sửa FE, commit/push/deploy hoặc thao tác dữ liệu thật. Git sạch ở đầu phiên. Không có AGENTS.md tại repo hoặc các thư mục cha đã kiểm tra; AGENTS.md trong dependency không áp dụng source repo.

## Kết quả đợt implementation ngày 19

Lượt full cuối trên snapshot implementation/test cuối đã hoàn tất: **49 suite pass, 0 fail, 0 skip; 395 test pass, 0 fail, 0 skip; exit code 0**, 143.037 giây. Lượt full ngay trước đó cũng 49/395 pass, exit 0 (143.653 giây). Không suy ra điểm số hay cam kết production từ test xanh. Các lỗi được tìm thấy ở những lượt trước được ghi ở dưới, không che bằng kết quả cuối.

`git diff --check` exit 0; chỉ có cảnh báo chuyển LF/CRLF. Không reset/stage thay đổi, không đọc/in `.env` hoặc secret. JSON kết quả test chỉ là artifact tạm, không bàn giao dữ liệu/log request.

Cleanup cuối: đã xóa JSON kết quả tạm và container Redis `totmart-session-20261019-redis` (exit 0). Container backup UUID đã được script tự xóa; MongoMemoryReplSet và child BE được test teardown. Không dừng Docker Desktop hay tài nguyên có sẵn của người dùng.

## Lỗi đã xác nhận và thay đổi

- Prepare lỗi địa chỉ trước khi ghi Attempt/trả hash: thêm `terminate-with-body`, dùng đúng schema validation/defaults/stripUnknown của create nhưng không tra địa chỉ/template. Ghi tombstone qua transaction/fence hiện có; payload không vượt validation không ghi Attempt. Giữ hash/API/replay legacy.
- Attempt routes thiếu quota: shared IP 300/phút, user 120/phút. Admission cap 10.000 record/user dùng transaction trên User để serialize count/insert, tính cả legacy và mọi state; existing recovery vẫn dùng được khi tới cap. Không TTL/xóa tombstone.
- Redis TCP im lặng vượt deadline HTTP: thêm deadline ứng dụng 2,5 giây cho phương thức Redis bảo mật đang dùng, probe client/subscriber, bounded queue và readiness fail closed/đóng stream. Driver queue timeout một mình không chặn lệnh đã gửi.
- Operations summary thêm attempt growth/capacity và cảnh báo webhook retry, outbox/refund quá hạn. Created vốn đã hỗ trợ nhiều giao dịch độc lập; không thêm reset endpoint hoặc đổi terminate thành hủy giao dịch.

## Môi trường và kịch bản thực chạy

- Node v24.14.1/Windows, Jest runInBand, `CI=true`, `LOG_LEVEL=silent`. Redis thật: container riêng `totmart-session-20261019-redis`, image `redis:7.4-alpine`, **server 7.4.11 standalone** đã kiểm tra bằng INFO, loopback cổng 16380; mỗi suite UUID namespace riêng. Không FLUSHDB. Docker Desktop được khởi động để chạy drill; không dừng tài nguyên có sẵn.
- MongoMemoryReplSet MongoDB 7.0.14, wiredTiger một member, port ngẫu nhiên/dữ liệu disposable. Không dùng URI ứng dụng. HTTP crash suite từ chối TEST_MONGODB_URI bên ngoài để không đổi cấu hình server dùng chung.
- HTTP: ADDRESS_NOT_FOUND/ADDRESS_CHANGED trước hash; validation failure; mất response prepare (logic bỏ qua response thành công); subscription conversion/default zipCode/stripUnknown; race create/terminate; sửa thông tin với key mới không trùng đơn. Hai đơn và hai subscription liên tiếp, key cũ không tiêu thụ giỏ mới hoặc sửa giao dịch mới. Kiểm tra DB và stock, không chỉ status.
- **Hai process Node riêng qua HTTP TCP**, không phải hai Redis client/store: quota user chung và IP quota khi luân phiên tài khoản, logout/single-session revocation và khóa tài khoản có hiệu lực ở process kia; SSE đóng qua security outbox worker + Pub/Sub thật. Stop/start Redis kiểm tra readiness, limiter 503 và worker publish backlog; subscriber nhận revocation sau reconnect. Pause/unpause Redis kiểm tra peer im lặng không treo HTTP.
- Crash có barrier chỉ trong test helper, giữ transaction ngay sau attempt write fence rồi SIGKILL đúng child do suite tạo. Process còn lại terminate; đối chiếu Order/Checkout/Attempt/stock/coupon. Mongo disposable **khởi động** với transactionLifetimeLimitSeconds=5; không cam kết production phục hồi dưới 15 giây với default 60 giây. Đây là crash **trước commit tại điểm xác định**, không phải unknown commit-result.
- Payment: webhook payload giả qua HTTP/service thật; duplicate/late/underpaid/overpaid và thanh toán cạnh tranh hủy/hết hạn. Đối chiếu event, allocation ledger, Checkout/Order/Attempt/stock và refund conservation. Coupon có regression consumption/release và crash checks riêng. Không chuyển tiền ngân hàng thật.
- Commerce migration CAS: dry-run legacy/conflict, apply, exception giữa batch abort toàn transaction, plan lại, manifest cũ báo CAS khi rerun, rollback không ghi đè sửa đổi sau apply. Interruption này là exception, chưa phải kill process migration tại mọi thời điểm.
- Checkout legacy CLI trên DB disposable: dry-run không ghi, apply tạo ledger v1, apply lại không ghi đè Checkout đã thay đổi, conflict ownership chặn apply, unique index tồn tại. Script này insert-only, không có rollback tự động; không xóa Checkout đã có hoạt động để giả lập rollback.
- Monitoring HTTP: đã quan sát tín hiệu security outbox cũ, webhook retry và refund quá hạn từ fixture DB. Admission boundary: 9.999 record và hai key cạnh tranh chỉ một được ghi, tổng 10.000, existing terminate vẫn thành công. Chưa gửi/nối alert tới hệ thống bên ngoài.

## Backup/restore thực chạy

`node scripts/drill-backup-disposable.js`: **PASS, exit 0**. `mongo:7.0` container UUID riêng, port loopback ngẫu nhiên, replica set một member. Writer dừng sau seed; mongodump archive gzip và mongorestore đổi namespace sang DB mới thật. Kiểm tra **6 collection**: counts, documents, indexes, quan hệ Order/Checkout và tổng allocation = receipt = principal + refund. Archive chỉ ở container disposable, xóa cùng đúng container script tạo. Không thay thế kiểm chứng script backup ngoài repo, mã hóa/retention/PITR hoặc tải production.

## Những lượt fail đã được xử lý

Lượt sandbox đầu: 1 suite/16 test fail, exit 1 do spawn EPERM; đã xin quyền và chạy mongod thật. Fixture mới từng sai vì giỏ bị checkout xóa, thiếu validFrom hoặc trùng orderId; đã sửa. Test pause Redis phát hiện thiếu deadline cho lệnh đã gửi và dẫn tới sửa BE. Bài kill ngẫu nhiên từng bỏ lại transaction default 60 giây, gây timeout request/cleanup; thay bằng barrier pre-commit xác định và thời hạn 5 giây trên Mongo disposable từ lúc khởi động. Assertion worker từng đọc state trước khi publisher ghi acknowledgement; nay đợi và vẫn yêu cầu published cùng stream closed. Không skip test, không thay Redis thật bằng mock, không bỏ assertion conservation.

## Điều kiện còn thiếu

Chưa kiểm chứng multi-node Mongo primary failover/network partition, unknown commit-result thật, kill lúc commit/ack, mọi điểm interruption migration, rolling writer cũ hoặc production load/sizing. Chưa diễn tập DB disconnect/reconnect qua hai process HTTP (DB readiness có unit coverage). Redis chỉ standalone, chưa Sentinel/Cluster/persistence/eviction. HTTP runner chỉ bật security worker, chưa chứng minh tất cả scheduler production qua outage. Chưa external provider/alert delivery, browser FE E2E, multi-tab/local persistence, proxy/cookie thực tế.

Cần staging diễn tập riêng, owner/SLO cho giám sát, backup vận hành đã kiểm chứng retention/mã hóa/PITR, reviewed migration/rollback và drain writer cũ trước nghiệm thu. Không tự tuyên bố 85/100.

FE cần dùng body gốc khi thiếu hash; không mở key mới từ 400/404/unknown/timeout; tách reference created cũ khỏi lần mua độc lập được user xác nhận, luôn giữ replay reference cũ. Xem [hợp đồng cuối](checkout-attempt-contract.md).

## Lịch sử ngày 18 (không phải kết quả hiện tại)

Ngày 2026-10-18 chỉ chỉnh tài liệu, chưa có những thay đổi implementation ngày 19 nêu trên. Nội dung tiếp theo giữ để đối chiếu lịch sử.

## Kết quả được tái xác minh

```text
Test Suites: 48 passed, 48 total
Tests:       374 passed, 374 total
Snapshots:   0 total
Time:        109.24 s
Exit code:   0
```

Đây là kết quả chạy lại trong đợt bàn giao này với cấu hình tường minh dưới đây, xác nhận con số user cung cấp. `test-results.log` đang có trong workspace là bản cũ 47 suite/370 test có skip; không dùng bản đó làm bằng chứng lần mới và không sửa/xóa nó. Log mới lưu ở thư mục TEMP của hệ điều hành, ngoài Git; tài liệu chỉ chứa kết quả tổng hợp, không copy log request/PII.

## Cấu hình thực tế của lần chạy

- Windows PowerShell, Node.js v24.14.1. `npm test` dùng Jest, `node --experimental-vm-modules`, `--runInBand`; lần này thêm `--silent`.
- `CI=true`: tests/redisLive.integration.test.js sẽ throw nếu thiếu TEST_REDIS_URL, không âm thầm skip.
- `TEST_REDIS_URL=redis://127.0.0.1:6380`. Docker container test hiện hữu `totmart-redis-test-6380`, image tag redis:7.4-alpine, publish chỉ 127.0.0.1:6380→6379. `redis-cli PING` trả PONG, `INFO server` xác nhận **redis_version:7.4.11**, mode standalone. Đây là Redis process thật, không phải mock server.
- `TEST_MONGODB_URI` được bỏ trong process test, `MONGOMS_VERSION=7.0.14`: helper dùng MongoMemoryReplSet một member, storageEngine wiredTiger, URI loopback ngẫu nhiên, tạo indexes qua model.init. Không dùng container Mongo acceptance có sẵn hoặc MONGODB_URI ứng dụng để chạy integration.
- tests/env.setup.js đặt NODE_ENV=test, REDIS_URL rỗng, REDIS_NAMESPACE=totmart:test, TRUST_PROXY=0 và cấu hình fixture/test cho auth/webhook. Không ghi giá trị secret vào tài liệu. Đây không phải cấu hình production.
- Redis suite tạo hai Redis client và subscriber thật, namespace `totmart:test:<randomUUID>` riêng từng lượt. Cleanup chỉ DEL các key test đã ghi và đóng client, không FLUSHDB. Mỗi test kiểm tra: chia sẻ quota qua hai RedisRateLimitStore; GETDEL chỉ lấy ticket một lần; Pub/Sub nhận qua subscriber riêng. Suite có spy getClient/namespace để bơm client thật vào service, nhưng I/O Redis là thật.
- Các test còn lại vẫn có REDIS_URL rỗng theo setup; kết quả không có nghĩa mọi HTTP flow/auth revocation được chạy end-to-end qua Redis thật. Đây là giới hạn cần giữ rõ.

Lệnh tái lập PowerShell (cần quyền khởi động mongod tạm và Redis test riêng đã sẵn sàng):

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6380'
$env:TEST_MONGODB_URI = ''
$env:MONGOMS_VERSION = '7.0.14'
$env:CI = 'true'
npm test -- --silent
```

Nếu khởi động Redis bằng Compose của repo, dùng `docker compose -f compose.redis-test.yml up -d --wait redis-test` khi cổng 6380 chưa có dịch vụ khác. Trong lần này, Compose không phải container phục vụ test: container hiện hữu đã giữ cổng nên không thay thế/dừng nó. Thay đổi Compose 6379→6380 là cấu hình test loopback đã có trong working tree, được giữ nguyên. Không suy ra lịch sử chạy trước từ trạng thái container hiện tại; cấu hình và kết quả trên thuộc lần tái xác minh này.

## Rà soát diff và vệ sinh thay đổi

Đã đọc diff các controller/service/model/router/schema và test/Compose thay đổi, cùng toàn bộ các file mới (CheckoutAttempt, checkoutAttemptService, migration và recovery integration test). Endpoint/hình dạng response được đối chiếu lại với route/service/error handler/auth/validation/cookie-CSRF. Không mở hay in nội dung .env/secret của máy.

`git diff --check` pass. Git chỉ cảnh báo LF→CRLF dự kiến với compose.redis-test.yml, không có whitespace error. Các thay đổi có sẵn không bị reset, ghi đè hoặc stage. Danh sách file dự kiến bàn giao chỉ gồm source BE, test, script migration, cấu hình Redis test và hai tài liệu.

Kiểm tra file tracked thay đổi và untracked không bị ignore: không có .env, private key, credential URI, token literal, log, dump, node_modules/cache hoặc file cấu hình máy cá nhân. Scan pattern private-key/AWS/GitHub token/JWT/URI có credential không phát hiện hit; kết hợp đọc diff thủ công, đây không phải chứng nhận rằng công cụ dò secret có thể bắt mọi định dạng.

`test-results.log` cũ vẫn được .gitignore loại qua `*.log`; log xác minh mới ở TEMP. Không thêm các log hoặc manifest migration/data backup vào thay đổi. Không có thay đổi staged từ thao tác bàn giao; không commit/push/deploy.

## Giới hạn và bước tiếp theo

Xem đầy đủ [hợp đồng API và checklist FE](checkout-attempt-contract.md), đặc biệt mục 5 về addressHash/legacy, mục 6 về FE, mục 7 về migration/rollback, mục 8 về giới hạn test.

Chưa chạy production/staging migration, multi-node failover hoặc unknown-commit-result thật, browser E2E, rolling deployment với writer cũ, Redis cluster/outage/persistence, Cloudinary/email/bank thật. Tests dùng dữ liệu giả lập; test mất phản hồi sau commit mô phỏng bằng bỏ response thành công rồi retry. Lượt pass này cho phép bàn giao integration BE cho đợt FE tiếp theo, không thay thế smoke/diễn tập vận hành trước triển khai.
