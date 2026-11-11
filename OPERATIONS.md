# TotMart — nghiệm thu và vận hành

Current local operational evidence: [B07 verification](docs/B07-verification.md), [incident/backup/migration runbook](docs/B07-operations-runbook.md) and [review-only release plan](docs/B07-release-plan.md). Earlier tool/permission/backup notes below are historical; they do not authorize using an existing environment or prove current checks.

Quyết định Q ngày22/10/2026: [B-A1-AV01 là P2 còn mở, chấp nhận có điều kiện](docs/BE-open-issues.md), chỉ cho wait trong transaction/commit; auth/read A1 ngoài transaction vẫn giữ5s. Xem [drain khi Mongo im lặng](docs/B07-operations-runbook.md#mongo-silent-transaction-drain-b-a1-av01). Edge deadline và alert readiness/p99 ở đích chưa xác minh; retry120s không phải hard deadline. Phải đóng issue trước staging người dùng thật/mở bán; xem lại sau DR03/DR05 và phase tải. Không phát sinh quyền thao tác hạ tầng từ ghi chú này.

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

## Cấu hình MongoDB Timeouts và Ngân sách Transaction (B-A1-AV01)

Nhằm giới hạn trần thời gian khi MongoDB hoặc kết nối mạng bị treo/im lặng (silent I/O), TotMart BE cấu hình các timeout phân lớp:

- `MONGO_SOCKET_TIMEOUT_MS` (mặc định 45000ms): thời gian tối đa chờ phản hồi socket cho mỗi thao tác gửi/nhận MongoDB.
- `MONGO_WAIT_QUEUE_TIMEOUT_MS` (mặc định 5000ms): thời gian tối đa một request chờ lấy connection từ pool khi pool đầy.
- `MONGO_MAX_COMMIT_TIME_MS` (mặc định 10000ms): giới hạn tối đa cho lệnh `commitTransaction` trên MongoDB server.
- `MONGO_TRANSACTION_TIMEOUT_MS` (mặc định 15000ms): tổng trần thời gian cho một transaction thực thi qua `withTransaction` (Client-Side Operation Timeout).

Khi xảy ra timeout:

- Request nhận mã lỗi HTTP 503 (`Database temporarily unavailable` hoặc `Lỗi hệ thống. Vui lòng thử lại.`).
- Hợp đồng idempotency được bảo toàn nguyên vẹn: CheckoutAttempt không bị xóa, không bị drop tombstone.
- Client/frontend replay lại với cùng `Idempotency-Key` và request body để nhận lại kết quả hoặc hoàn tất giao dịch một cách an toàn mà không bị trừ kho/tạo nghĩa vụ hai lần.

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

## Proxy, Reverse Proxy and Rate Limiting

- `TRUST_PROXY`: Bắt buộc phải khai báo rõ ràng trong môi trường `production` và `staging`. Khi chạy phía sau reverse proxy (Render, Nginx, AWS ALB, Cloudflare), đặt `TRUST_PROXY=1` (hoặc số hop tương ứng) để Express nhận diện đúng client IP từ header `X-Forwarded-For`.
- Nếu triển khai máy chủ độc lập không qua reverse proxy (`TRUST_PROXY=0`), cần đặt thêm `TRUST_PROXY_CONFIRMED_DIRECT=true` để xác nhận chủ ý và tắt cảnh báo khởi động `env_warning`.
- Cơ chế giới hạn tỷ lệ (Rate Limiting) hai tầng cho SePay webhook (`/api/checkout/sepay-webhook`):
  1. **Pre-auth flood filter** (`webhookFloodLimiter`): 300 req/phút/IP, chạy trước tầng xác thực nhằm ngăn chặn DDoS flood tầng mạng.
  2. **Post-auth business limiter** (`webhookLimiter`): 60 req/phút/IP, chỉ áp dụng sau khi API key SePay đã được xác thực bằng `timingSafeEqual`. Nhờ đó, các request giả mạo/sai key không làm cạn kiệt hạn mức của webhook hợp lệ từ SePay.

## Session rotation and staging policy

See [refresh family state machine, retention, legacy cutover and rollback](docs/refresh-family-policy.md).
`NODE_ENV=staging` now uses production configuration validation and requires session `sid` at HTTP/SSE authentication entrypoints, with Secure cookies. Deploy all auth writers together with additive indexes; preserve the same `JWT_REFRESH_SECRET` across instances. Do not roll back to code that ignores `revokedAt`. Local proxy fixture tests do not constitute staging validation.

## Cấu hình triển khai Render (render.yaml) và Danh mục biến môi trường

### 1. Danh mục biến môi trường hoàn chỉnh (Environment Variables Reference)

Toàn bộ các biến môi trường được quản lý tập trung và xác thực nghiêm ngặt qua `src/config/resolveEnvironment.js` và `src/config/environmentChecks.js`:

| Biến môi trường                   | Bắt buộc (Prod) | Kiểu / Ràng buộc                                     | Giá trị gợi ý (Render)                        | Mục đích & Ràng buộc an ninh                                                    |
| :-------------------------------- | :-------------: | :--------------------------------------------------- | :-------------------------------------------- | :------------------------------------------------------------------------------ |
| `NODE_ENV`                        |     **Có**      | `production` \| `staging` \| `test` \| `development` | `production`                                  | Chế độ runtime; kích hoạt xác thực an ninh nghiêm ngặt                          |
| `PORT`                            |     **Có**      | Integer `1..65535`                                   | `3001` (hoặc `10000`)                         | Cổng lắng nghe HTTP do Render cấp hoặc cấu hình                                 |
| `TRUST_PROXY`                     |     **Có**      | `1` \| `0` \| `loopback`...                          | `1`                                           | **Bắt buộc = 1** sau reverse proxy của Render để rate limit nhận đúng client IP |
| `TRUST_PROXY_CONFIRMED_DIRECT`    |      Không      | `true` \| `false`                                    | `false`                                       | Chỉ đặt `true` nếu chạy `TRUST_PROXY=0` trực tiếp không qua proxy               |
| `MONGODB_URI`                     |     **Có**      | URI `mongodb+srv://` hoặc `mongodb://`               | `mongodb+srv://...`                           | Chuỗi kết nối MongoDB Replica Set (Atlas Singapore `ap-southeast-1`)            |
| `REDIS_URL`                       |     **Có**      | URI TLS `rediss://...`                               | `rediss://default:...@...`                    | Chuỗi kết nối Redis Upstash (Singapore). Bắt buộc TLS `rediss://` ở production  |
| `REDIS_NAMESPACE`                 |     **Có**      | String `^[a-z0-9:_-]{3,80}$`                         | `totmart:production`                          | Namespace cô lập key cache, quota rate limit và Pub/Sub                         |
| `JWT_SECRET`                      |     **Có**      | String >= 32 chars ngẫu nhiên                        | _(Tạo ngẫu nhiên)_                            | Khóa ký Access Token JWT; không dùng chuỗi mẫu; khác `JWT_REFRESH_SECRET`       |
| `JWT_REFRESH_SECRET`              |     **Có**      | String >= 32 chars ngẫu nhiên                        | _(Tạo ngẫu nhiên)_                            | Khóa ký Refresh Token JWT; tách biệt hoàn toàn với `JWT_SECRET`                 |
| `FRONTEND_URL`                    |     **Có**      | URL `https://...` (không trailing slash)             | `https://totmart.vn`                          | Origin public của client frontend; dùng cho CORS allowlist và email link        |
| `CORS_ORIGINS`                    |      Không      | Danh sách URLs phân tách dấu phẩy                    | `https://totmart.vn,https://admin.totmart.vn` | Danh sách các origin được phép gọi API (bắt buộc HTTPS ở production)            |
| `SEPAY_API_KEY`                   |     **Có**      | String (API token SePay)                             | _(Token SePay thật)_                          | Khóa xác thực webhook thanh toán ngân hàng SePay                                |
| `SEPAY_BANK_ACCOUNT`              |     **Có**      | String                                               | _(Số tài khoản ngân hàng)_                    | Số tài khoản nhận tiền đối soát                                                 |
| `SEPAY_BANK_NAME`                 |     **Có**      | String                                               | `MBBank` / `VCB`...                           | Tên ngân hàng nhận tiền                                                         |
| `CLOUDINARY_CLOUD_NAME`           |     **Có**      | String                                               | _(Tên Cloudinary cloud)_                      | Lưu trữ và phân phối hình ảnh sản phẩm                                          |
| `CLOUDINARY_API_KEY`              |     **Có**      | String                                               | _(API Key Cloudinary)_                        | Khóa API Cloudinary                                                             |
| `CLOUDINARY_API_SECRET`           |     **Có**      | String                                               | _(API Secret Cloudinary)_                     | Khóa bí mật Cloudinary                                                          |
| `BREVO_API_KEY`                   |      Không      | String                                               | _(Khóa Brevo nếu có)_                         | Dịch vụ gửi email thông báo / reset password                                    |
| `FROM_EMAIL`                      |      Không      | String (Email format)                                | `no-reply@totmart.vn`                         | Địa chỉ email người gửi                                                         |
| `LOG_LEVEL`                       |      Không      | `fatal`\|`error`\|`warn`\|`info`\|`debug`            | `info`                                        | Mức log của Pino logger trong production                                        |
| `BCRYPT_COST`                     |      Không      | Integer `10..15`                                     | `12`                                          | Số vòng băm mật khẩu bcrypt (mặc định 12)                                       |
| `MONGO_SOCKET_TIMEOUT_MS`         |      Không      | Integer `1000..300000`                               | `45000`                                       | Thời gian tối đa chờ phản hồi socket cho mỗi lệnh MongoDB                       |
| `MONGO_WAIT_QUEUE_TIMEOUT_MS`     |      Không      | Integer `500..60000`                                 | `5000`                                        | Thời gian tối đa chờ lấy connection từ pool khi pool đầy                        |
| `MONGO_MAX_COMMIT_TIME_MS`        |      Không      | Integer `1000..60000`                                | `10000`                                       | Giới hạn tối đa cho lệnh commitTransaction trên MongoDB                         |
| `MONGO_TRANSACTION_TIMEOUT_MS`    |      Không      | Integer `1000..120000`                               | `15000`                                       | Trần thời gian tối đa cho toàn bộ transaction qua withTransaction               |
| `MONGO_MIN_POOL_SIZE`             |      Không      | Integer `0..50`                                      | `2`                                           | Số socket tối thiểu mở sẵn trong pool MongoDB (giữ kết nối ấm)                  |
| `MONGO_MAX_POOL_SIZE`             |      Không      | Integer `1..100`                                     | `10`                                          | Số socket tối đa trong pool MongoDB (phù hợp 1 instance 512MB RAM)              |
| `MONGO_MAX_IDLE_TIME_MS`          |      Không      | Integer `1000..300000`                               | `45000`                                       | Thời gian tối đa giải phóng socket nhàn rỗi trong pool                          |
| `REDIS_KEEP_ALIVE_MS`             |      Không      | Integer `1000..300000`                               | `30000`                                       | Khoảng thời gian gửi TCP keep-alive probe giữ kết nối TLS Upstash ấm            |
| `REDIS_PING_INTERVAL_MS`          |      Không      | Integer `500..60000`                                 | `1000`                                        | Chu kỳ health check ping Redis (khuyến nghị `15000..30000` trên Upstash)        |
| `ORDER_EXPIRY_HOURS`              |      Không      | Number > 0                                           | `24`                                          | Thời gian hết hạn của đơn hàng chưa thanh toán                                  |
| `CHECKOUT_SESSION_EXPIRY_MINUTES` |      Không      | Integer `5..60`                                      | `15`                                          | Thời gian hiệu lực của phiên checkout                                           |

### 2. Thiết lập Render Blueprint (`render.yaml`)

File [`render.yaml`](render.yaml) đã được thiết lập sẵn ở thư mục gốc repo:

- **Region**: `singapore` (đồng bộ khu vực địa lý với MongoDB Atlas `ap-southeast-1` và Upstash Singapore để tối thiểu hóa RTT mạng).
- **Health Check Path**: `/api/home/live` (Endpoint **liveness**, trả về 200 `status: 'alive'` tức thời mà không truy vấn DB. Giúp ngăn chặn Render tự ý khởi động lại container khi database hoặc Redis có độ trễ ngắn).
- **Auto Deploy**: `true` (Tự động kích hoạt build khi merge/push vào nhánh chính).
- **Quản lý Secrets**: Tất cả secret (`MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, v.v.) được đánh dấu `sync: false` trong `render.yaml` để nhà vận hành tự điền an toàn trên Dashboard Render, ngăn ngừa rò rỉ credential vào Git.

### 3. Đề xuất về `preDeployCommand` (Tách đồng bộ Index)

- **Hiện trạng gói Free**: Render Free plan **không hỗ trợ** `preDeployCommand`. Mọi thao tác khởi tạo index bắt buộc phải hoàn tất trong quá trình web service khởi động (được tối ưu song song hóa ở Giai đoạn 3).
- **Đề xuất khi nâng cấp lên gói Starter trở lên**:
  Nếu nâng cấp lên gói có phí (Starter $7/tháng trở lên), đề xuất cấu hình:
  ```yaml
  preDeployCommand: 'node scripts/sync-indexes.js'
  ```
  Lợi ích: Toàn bộ 24 model sẽ hoàn tất `createIndexes()` trong bước deploy riêng biệt trước khi container mới mở traffic, giúp giảm cold start của web service xuống dưới 1 giây.
