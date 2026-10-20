# B01 — runtime và kiểm chứng Redis/teardown

Biên bản cho lần chạy ngày 2026-10-20; kết quả chỉ áp dụng cho snapshot được ghi trong artifact, không bảo đảm chất lượng tương lai hoặc mức sẵn sàng production.

## Snapshot và phạm vi

- Repo BE đúng cwd đã yêu cầu; HEAD đầu đợt `3b1ada58336ad401fa178d246cec31b48291337a`. Ban đầu chỉ có `?? AGENTS.md` từ đợt trước; không có tracked/staged diff. Đã đọc hướng dẫn áp dụng; giữ file này và chỉ cập nhật phần runtime/test liên quan B01.
- Không sửa `src/`, FE, logic tiền hoặc hợp đồng API. Không commit/push/deploy/migration dữ liệu dùng chung. Các test migration sẵn có chỉ chạy trên replica set fixture dùng một lần.
- Snapshot cuối của các file thực thi được lưu SHA-256 trong `source-sha256.json` của từng lượt. `package-lock.json` chỉ đổi engine ở package gốc; đối chiếu toàn cây dependency sau khi bỏ metadata engine cho kết quả giống HEAD, exit `0`.

## Thay đổi

- `tests/helpers/localRedisUrl.js`: validator chung cho cả hai suite, chấp nhận database `0..15` theo cấu hình Redis test mặc định 16 database; từ chối credentials, host khác localhost/127.0.0.1, port sai, escape/query/fragment và database bất hợp lệ. Không chỉ bỏ `/15` khỏi CI.
- `tests/helpers/disposableRedis.js`: mỗi lease tự tạo container có ID và label UUID riêng, port loopback cố định qua restart, `/data` tmpfs, không persistence/volume. Kiểm ID/label/tên/binding trước mutation, mapping active trước stop/pause và sau start/unpause. Docker Desktop bỏ active Ports khi paused/stopped: recovery kiểm binding đã chốt, không nhận URL mới từ state. Setup lỗi vẫn tìm lại đúng ID theo tên/label do chính lease tạo để cleanup; lỗi cleanup không thay lỗi setup gốc.
- `tests/redisHttp.integration.test.js`: Redis outage riêng với primitives; assertion Redis primitives vẫn PONG trong stop và pause. Crash drill từ chối `TEST_MONGODB_URI`, tự tạo Mongo disposable. Guard theo trạng thái khởi tạo; không gọi Redis đang outage khi teardown. `tests/helpers/http-process.js` báo phase startup qua IPC, không gửi thông tin credential/lỗi DB thô.
- `tests/helpers/db.js`: giữ reference replica set trước startup; chỉ clear/drop DB đã connect; luôn thử close/stop resource đã khởi tạo. `tests/redisLive.integration.test.js`: đóng client trong finally, kể cả xóa key fixture lỗi.
- Thêm `tests/localRedisUrl.test.js`, `tests/disposableRedis.test.js`, `tests/dbLifecycle.test.js`, `tests/httpSetupFailure.test.js`. Hai test subprocess xác nhận HTTP suite thực sự exit `1` khi URL sai/Mongo target có sẵn, không skip và không xuất hiện lỗi timeout teardown; đây là kiểm chứng guard, không phải HTTP nghiệp vụ pass.
- `scripts/run-be-tests.js`, `tests/helpers/noDotenv.js`, `tests/env.setup.js`: runner dùng chung CI/local, loại target/credential kế thừa, không tải `.env`, tách Redis primitives và HTTP, lưu exit code Jest gốc, kết quả đã lọc, resource ownership/cleanup và coverage toàn `src/**/*.js` không áp ngưỡng. Artifact dùng thư mục riêng từng lượt để tránh kết quả cũ.
- `package.json`, metadata engine `package-lock.json`, `README.md`, `AGENTS.md`: chỉ hỗ trợ Node `>=24 <25`; không tuyên bố hỗ trợ Node 22 chưa được chứng minh. Dockerfile và CI vốn dùng Node 24 nên giữ runtime này. Workflow bỏ Redis service dùng chung, dùng runner HTTP rồi full BE, upload artifact kể cả failure. `.gitignore`/`.dockerignore` loại artifacts khỏi Git/build context.

## Kiểm chứng và bằng chứng

- Windows: Node `24.14.1`, npm `11.11.0`; `npm ci` trong sandbox exit `1` (spawn EPERM), chạy lại có quyền ngoài sandbox exit `0`. Không đổi dependency để né lỗi. Docker Desktop lúc đầu chưa chạy; đã khởi động và xác minh daemon `29.1.3`.
- Ubuntu WSL `24.04.3`: tải Node `24.14.1` chính thức vào thư mục tạm riêng, đối chiếu SHA-256 chính thức thành công, npm `11.11.0`, `npm ci` exit `0`. Redis Linux `redis:7.4-alpine`, MongoDB `7.0.14` replica set thật, WiredTiger; dữ liệu fixture, port/namespace riêng. CI chốt Ubuntu `24.04`, dùng cùng runner/lockfile; lượt local không phải job GitHub-hosted.
- `npm audit --omit=dev --audit-level=high` trên Ubuntu: exit `0`, không có vulnerability production dependency. `npm ci` báo 19 moderate ở toàn bộ dependency tree; không chạy audit fix/nâng dependency trong B01.
- Lượt đầu Windows HTTP: exit `1`, 0 pass/8 fail/0 skip do startup deadline; chưa xác định nguyên nhân cold-start, không nâng deadline. Sau thêm IPC chẩn đoán, startup không tái hiện lỗi. Lượt tiếp theo Windows HTTP: 6 pass/2 fail/0 skip, exit `1`, do harness hiểu sai Docker paused Ports; đã sửa và thêm mô phỏng tương ứng. Windows HTTP sau sửa đạt 8 pass/0 fail/0 skip, exit `0`.
- Linux trước sửa pause: HTTP exit `1`, 6 pass/2 fail/0 skip; full BE exit `1`, 51/52 suite pass, 429 pass/2 fail/0 skip. Không xem các lượt này là đạt. Các container paused của lượt lỗi đã được xác minh ID/label/binding và unpause/dọn riêng; các lượt sau dùng tmpfs.
- Snapshot cuối trên Ubuntu: `npm run test:b01:http` exit `0`, 1 suite/8 pass/0 fail/0 skip; sau đó `npm run test:b01` exit `0`, 53 suite/435 pass/0 fail/0 skip (263,063 giây). `exit.json` lưu riêng Jest exit và runner exit, cả hai đều `0`.
- Artifact bàn giao: `artifacts/b01/linux-release/http-6jsd9S/` và `artifacts/b01/linux-release/all-ylqvfP/`; `commands.json` và `verified.json` ở thư mục cha. Đã tính lại đủ 186 hash source thực thi/config cho cả hai lượt: không có khác biệt với working tree cuối. Artifact ignored bởi Git; CI có upload tự động, local giữ tại workspace.
- Baseline full-suite toàn `src/**/*.js`: statements **68,33%**, branches **62,53%**, functions **65,73%**, lines **72,29%**. Có [HTML coverage](../artifacts/b01/linux-release/all-ylqvfP/coverage/lcov-report/index.html), LCOV và JSON summary; chưa đặt threshold. Unit harness độc lập trước đó: 3 suite/38 pass/0 fail/0 skip, exit `0`; hai test guard subprocess thêm sau đó nằm trong full-suite cuối.
- `http-resource.json`/`primitives-resource.json` ghi ID/label/URL của đúng lượt: hai URL/ID khác nhau, tmpfs và `cleaned:true` cho cả hai lượt cuối. Kiểm tra Docker sau test exit `0`: không còn container mang label harness; 0/8 anonymous volume fixture cũ còn lại sau đối chiếu create/mount events và kiểm tra không còn attachment. Không prune/chạm volume khác. Bằng chứng ownership cũ: `artifacts/b01/legacy-fixture-volume-ownership.json`.
- `git diff --check` exit `0`; không có diff trong `src/`. Quét artifact sau lọc: 0 mẫu JWT, connection URI có credential hoặc private key; đây là kiểm tra mẫu kết hợp với fixture/không tải `.env`, không phải chứng nhận an toàn tổng quát.
- Hai thư mục `/tmp` chứa bản sao source/dependency và Node Linux do phiên tạo đã được kiểm realpath rồi dọn sau khi sao chép artifact, exit `0`. Không sửa cài đặt Node dùng chung; cache binary của công cụ được giữ để tránh tải lại.
- Truy vấn GitHub Actions qua connector cho đúng HEAD trả `workflow_runs: []`. Chưa có job CI thực tế của thay đổi chưa commit; không tự push/kích hoạt deployment để lấy kết quả.

Artifact chỉ có số lượng, tên/status/duration test, hash source, metadata test container và coverage; bỏ console output, assertion values, failure stack và đường dẫn máy cá nhân khỏi JSON công bố. Không đọc/in `.env` hoặc dùng credential/PII thật. Không đưa raw Jest JSON tạm vào vùng artifact upload.

## Giới hạn, rủi ro và quay lui

- Unit/mock, HTTP local với hai tiến trình thật và integration DB là các mức bằng chứng khác nhau. Chưa kiểm chứng browser service, bấm UI E2E, ngân hàng/email/SMS/upload thật, HA/failover hay production. Coverage HTTP riêng không instrument code trong tiến trình con, nên không dùng số đó để suy ra độ phủ E2E; full-suite coverage là baseline, không phải điểm chất lượng.
- Node 22 bị loại khỏi release support; môi trường đang dùng Node 22 phải chuyển sang 24 trước khi dùng bản này. Runner cần quyền chạy Docker Linux và tải image/binary nếu chưa cache. Cạnh tranh cổng giữa lúc chọn port và Docker bind sẽ fail an toàn, không fallback sang Redis dùng chung.
- SIGKILL/mất máy có thể ngăn finally chạy; không dọn hàng loạt để khắc phục. Dùng metadata ownership của đúng lượt, xác minh ID/label/binding trước khi xử lý tài nguyên còn lại. Không stop/remove tài nguyên người dùng hoặc prune volume.
- Quay lui bằng patch đảo đúng các thay đổi B01 đã review; giữ AGENTS.md có sẵn và thay đổi người dùng. Đồng bộ engine package/lock/README khi đảo; không reset toàn repo. Không có migration hay dữ liệu nghiệp vụ cần rollback.
