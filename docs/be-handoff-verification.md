# Biên bản kiểm chứng bàn giao BE

Ngày kiểm chứng: 2026-10-18. Phạm vi: backend repo hiện tại, giữ nguyên source/test/Compose chưa commit. Đợt bàn giao chỉ chỉnh tài liệu; không sửa FE, commit/push/deploy hoặc thao tác dữ liệu thật.

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
