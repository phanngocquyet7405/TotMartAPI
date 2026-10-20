# B03 — tên hiển thị, email và mật khẩu

Ngày 20/10/2026. Chỉ BE; giữ nguyên diff B01/B02 có sẵn tại HEAD `84cef89`. Đã đọc AGENTS.md, biên bản B01/B02 và đối chiếu source/caller. Không dùng kết quả 466 test B02 làm bằng chứng B03. Không commit/push/deploy, không chạy migration/dry-run trên dữ liệu dùng chung, không làm refresh-token reuse B04.

Trạng thái cuối: **B03 đạt kiểm chứng local trên snapshot 57 suite/491 test, không fail/skip; CI còn chờ.** HTTP/full có cùng manifest 194 file, hash đều khớp source cuối. Shared migration và benchmark production chưa thực hiện; các giới hạn bên dưới không được coi đã giải quyết. Dừng sau B03, không làm B04.

## Hiện trạng xác nhận bằng đọc source trước sửa

- User.name và email đều required/unique trong schema; name là display name nhưng bị dùng làm khóa duy nhất. Register/update Joi đã giới hạn name 3–100 ký tự. Lỗi duplicate name tại register bị trả nhầm thành “Email đã được đăng ký”: đây là lỗi thiết kế danh tính, không phải verify password sai.
- API tạo user duy nhất là POST `/api/users/register` → userController.createUser. Không có route admin-create-user riêng; kể cả admin gọi register thì role ngoài whitelist bị bỏ và account mới vẫn là user. Admin cập nhật profile qua PUT `/api/users/update-user/:_id` với requireOwnerOrAdmin; whitelist không cho đổi email/password/role. Không thêm quyền hay endpoint mới trong B03.
- Register và reset gọi native bcrypt cost **9**; bootstrap-staging gọi cost **12**; acceptance-server gọi cost **10**; factories test dùng cost **4**. bcryptjs có dependency nhưng không thấy caller auth thực tế. Không đọc hash/dữ liệu thật nên không khẳng định mọi hash đang lưu có cost 9.
- Login tra email chính xác, bỏ qua bcrypt nếu không có user; không rehash. Forgot trả 200 khi không có email nhưng 500 nếu gửi mail lỗi. Cleanup reset token đã có CAS token hash; reset đã single-use qua securityRevocationService transaction/outbox. B03 giữ cơ chế này và không sửa refresh rotation.
- Register/reset cho 8–128 ký tự nhưng không xét UTF-8 byte; login cho tối thiểu 6 ký tự, không chặn input legacy dài. Chỉ đổi giới hạn ký tự thành 72 sẽ không đủ cho Unicode.

## Chính sách và thay đổi

### Display name

User.name bỏ unique; vẫn required, mới hoặc đổi name phải 3–100 ký tự, không trim/rename dữ liệu cũ. Document legacy không đổi name không bị từ chối chỉ vì giới hạn mới ở schema khi lưu trường khác. Validation HTTP hiện có vẫn giữ 3–100. Schema không tự drop MongoDB index.

Validator phân biệt document với Query: query-upsert của acceptance có runValidators không có method isModified của document; ngữ cảnh đó vẫn phải kiểm 3–100. Regression trên DB disposable chứng minh upsert thành công, email canonical và update tên quá ngắn bị từ chối; không coi việc chỉ đọc caller là đã chạy acceptance server/staging thật.

Nếu unique index name cũ còn tồn tại, duplicate name vẫn có thể bị MongoDB chặn. Register phân loại riêng thành 503 `IDENTITY_MIGRATION_REQUIRED`, message công khai `Registration temporarily unavailable`; không báo nhầm email hoặc authentication failure. Update bị index cũ chặn vẫn đi qua error handler hiện có. Tên trùng chỉ được đảm bảo sau khi hoàn tất bước index đã duyệt; không tuyên bố schema edit tự sửa DB đang chạy.

### Email canonical và legacy

- Canonical = JavaScript `trim().toLowerCase()`, áp dụng nhất quán cho model document mới/đổi email, query writers hiện có có sửa email, register, lookup fallback và script kiểm tra. Không bỏ dấu chấm, không bỏ `+tag`, không gộp domain/provider alias, không Unicode NFC/NFKC hay tự chuyển chủ tài khoản.
- Email mới lưu canonical; email legacy không tự sửa khi login, forgot hoặc update trường không phải email. Public profile update vẫn không cho sửa email; không mở email update cho admin qua whitelist cũ. Model/query writer nếu thực sự đổi email sẽ canonicalize và kiểm collision trước ghi; updateMany email bị từ chối, yêu cầu migration đã review. Raw collection/bulk writer ngoài các caller hiện có không phải đường ghi được chứng minh bởi policy này.
- Lookup ưu tiên email raw khớp chính xác để giữ hai account legacy case/whitespace khác nhau còn đăng nhập bằng định danh cũ. Nếu không exact, cursor đọc _id/email và so canonical theo cùng JS; chỉ một ứng viên mới được chọn. Có từ hai ứng viên thì login 401 chung, forgot 200 chung và không gửi mail; không thử lần lượt password của nhiều account. Collision cần quyết định của người quản lý, không tự chọn account đầu tiên.
- New create/email update kiểm cả legacy để không chiếm biến thể email đã tồn tại. Các writer mới canonicalize về cùng chuỗi; unique email index đang có là điểm chặn concurrent create. Không thay index email/collation hoặc tự cài canonical index mới trên dữ liệu chưa kiểm collision. Hồi quy concurrent register chạy với unique email index thật do helper khởi tạo.
- Fallback/missing-email và kiểm new email có thể scan O(N) projection _id/email. Cursor giới hạn bộ nhớ và dừng khi đã đủ kết luận (1 cho conflict, 2 cho ambiguity), nhưng không biến thành indexed lookup hay production performance proof. Chỉ tối ưu sau migration được duyệt và đo dữ liệu/phần cứng đích; không thêm identity/auth cache.

### Password policy và benchmark local

Giữ bcrypt hiện có. Baseline được đối chiếu từ [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): với hệ thống legacy còn dùng bcrypt, work factor tối thiểu khuyến nghị là 10 và cần quản lý giới hạn byte. [Tài liệu chính thức node.bcrypt.js](https://github.com/kelektiv/node.bcrypt.js#security-issues-and-concerns) xác nhận input UTF-8 chỉ có 72 byte đầu ảnh hưởng bcrypt; [compatibility](https://github.com/kelektiv/node.bcrypt.js#compatibility-note) nêu hỗ trợ prefix 2a/2b. Không suy ra mọi hash có nguồn gốc/encoding khác đều tương thích.

`scripts/benchmark-passwords.js` dùng giá trị tổng hợp ngẫu nhiên, không nhận/in password/hash thật. Artifact `artifacts/b03/password-benchmark.json`: Node 24.14.1, Windows, Xeon E-2276M, 12 logical CPUs, libuv pool mặc định; 5 mẫu/cost sau warmup:

- Cost 9: median 28,94 ms, max 31,90 ms, CPU 141 ms/5 mẫu.
- Cost 10: median 54,69 ms, max 56,41 ms, CPU 266 ms/5 mẫu.
- Cost 11: median 110,61 ms, max 118,56 ms, CPU 562 ms/5 mẫu.
- Cost 12: median 212,48 ms, max 216,06 ms, CPU 1063 ms/5 mẫu.
- Cost 13: median 422,81 ms, max 437,21 ms, CPU 2109 ms/5 mẫu.
- Bốn compare cost 12 đồng thời: wall 225,98 ms, tổng process CPU 938 ms. Đây là workstation/local microbenchmark, không độc quyền CPU, không bao gồm DB/network, không throughput production hay p95/SLO production.

Chọn default **12** trên bằng chứng local khoảng 212 ms và tránh hạ baseline bootstrap 12; không bắt mọi máy phải dùng 12. `BCRYPT_COST` cho phép số nguyên 10–15, mặc định 12, giá trị khác fail cấu hình. Chủ môi trường phải benchmark/review trước chỉnh cost hoặc rollout. Tests pin 12 để không kế thừa tuning của developer. Register dùng policy chung; bootstrap giữ minimum 12, acceptance minimum 10 (default hiện tại tăng lên 12). Không chạy các script bootstrap/acceptance trên môi trường dùng chung.

Hash mới/reset dùng max(policy, cost hash đã đọc); hash cao hơn không bị giảm. Login verify hash legacy bằng bcrypt đang dùng; nếu cost thấp và input phù hợp policy, hash lại sau verify đúng/active rồi update với điều kiện _id + hash quan sát + tokenVersion + active. Nếu password/reset/lock thay đổi khi hash đang tính, CAS không match thì trả 401 chung, không ghi đè và không tạo session mới. Rehash không tự tăng tokenVersion hay thu hồi session vì không đổi bí mật người dùng.

Fence version 0 khớp cả field 0 và field chưa tồn tại, đúng default Mongoose/auth của account legacy; version khác 0 phải khớp chính xác. Không buộc backfill tokenVersion mới được login/reset, không nới phiên đã revoke. Regression dữ liệu raw thiếu field chứng minh login/protected read được trước migration, reset tăng version thành 1 và token cũ bị chặn.

Mật khẩu mới/reset: vẫn tối thiểu 8 ký tự, thêm điều kiện well-formed Unicode và tối đa **72 byte UTF-8**, không trim/normalize/cắt chuỗi hay tự pre-hash. Unicode/NUL trên bcrypt 6 được test. Login giữ input legacy: nếu dài >72 byte (hoặc không đáp ứng policy input mới) vẫn verify theo bcrypt legacy, không rehash âm thầm; response thành công thêm `passwordChangeRequired:true`, `passwordPolicyReason:LEGACY_BCRYPT_BYTE_LIMIT`. Legacy vốn coi các suffix sau 72 byte là tương đương; B03 không thể khôi phục phần bí mật chưa từng được hash. Account này cần reset chủ động; flag không có nghĩa weakness legacy đã được loại bỏ, và hash cost thấp của account đó có thể còn cho tới reset.

Missing user dùng một dummy hash random ở policy cost, khởi tạo async **một lần/process**. Failed compare của hash legacy cost thấp được thêm một dummy compare. `artifacts/b03/verification-timing.json` đo 7 lần mỗi nhánh crypto: missing median 216,93 ms; current-invalid 210,51 ms; legacy-invalid 220,42 ms (CPU tổng lần lượt 1516/1484/1531 ms). Chỉ giảm chênh lệch CPU nhánh thông thường; không tuyên bố constant-time toàn request. Hash cost cao hơn, exact/fallback DB scan, session creation, startup và network vẫn có timing khác nhau.

### Forgot/reset và logging

Forgot dùng lookup legacy/canonical trên input đã qua validation; email có/không có, ambiguity, provider trả failure hoặc throw đều có public 200/body chung. Không dùng lỗi gửi mail làm status dò account. Token ngẫu nhiên 10 phút và lưu SHA-256 như trước; update chỉ reset fields, cleanup provider lỗi chỉ unset nếu token hash vẫn bằng token request đó. Lỗi request cũ không xóa token mới; lỗi cleanup được log event generic và không làm lộ account ra response.

sendEmail không log provider error object/recipient/HTML/reset URL/API key; chỉ dependency/event chung. Mail vẫn synchronous và provider latency có thể khác nhánh không có account: public response uniform không đồng nghĩa loại bỏ mọi timing side channel của forgot. DB/system lỗi không bị che thành gửi mail thành công giả; đó là giới hạn khác provider failure.

Reset đọc token còn hạn, hash với cost không giảm, rồi dùng revocation transaction cũ với selector token/expiry/password preimage/tokenVersion. Điều kiện expiry của write dùng `$expr` so resetPasswordExpires với `$$NOW` của MongoDB, không giữ mốc Date phía app từ trước transaction qua những lần admission/retry. Token chỉ tiêu thụ một lần, revoke sessions/outbox và clear cookies giữ nguyên. Không thay B04 refresh reuse; đồng hồ môi trường vẫn cần được vận hành đồng bộ, không suy ra đảm bảo wall-clock tại thời điểm commit từ test local.

## API/FE và tương thích

- POST `/api/users/register`: display name trùng hợp lệ sau bước index; email trả canonical, canonical conflict 409; password >72 byte/ill-formed Unicode 400. Index name legacy chưa được gỡ có thể 503 như trên. Không cho admin tự chỉ định role qua register.
- POST `/api/home/login`: vẫn success/token, cookie/session như trước; exact legacy login giữ được, fallback mơ hồ trả 401 chung; CAS race 401; optional passwordChangeRequired/reason cho input legacy. Không bắt frontend hiện có phải gửi DTO mới.
- POST `/api/home/forgot-password`: provider failure đổi từ 500/body riêng sang cùng 200/body generic. Validation/rate limit hiện có vẫn áp dụng trước controller.
- POST `/api/home/reset-password`: giữ body token và alias query token cũ, single-use/expiry; password mới có byte limit. Profile/admin update whitelist giữ nguyên; không thêm endpoint đổi password/email/role.
- FE không sửa. Form đang cho tối đa 128 ký tự có thể nhận backend 400 cho Unicode/byte vượt 72; client cũ có thể bỏ qua cờ passwordChangeRequired, cần review trải nghiệm reset riêng. Không âm thầm sửa FE để che thay đổi này.

## Dry-run, apply và rollback để review

`node scripts/review-user-identity.js --dry-run` chỉ đọc MongoDB URI được operator đặt tường minh trong biến **B03_MONGODB_URI**, không tải .env. Không in URI, credential, email/name/hash password. Report có index key/options phân loại và record IDs của collision/invalid kiểu/rỗng; đây là manifest nhạy cảm, phải giữ riêng có kiểm soát, không đưa artifact dữ liệu thật lên Git/CI. `ready` là kết quả kiểm dataset/options đã lập trình, không phải approval rollout hoặc bằng chứng đã đủ mọi index/security/performance gate.

Nhận diện candidate: unique=true, key chỉ name:1 hoặc name:-1 và options đã hiểu (v/key/name/ns/unique/sparse/collation/background/hidden). Tên index có thể bất kỳ. Index ghép, email index, non-unique name không bị drop. Single-name partial/unknown options yêu cầu manual review và chặn apply; không tự suy đoán semantics từ tên `name_1`. Apply kiểm lại index specification/options và preimage dataset để từ chối stale plan.

Email update dùng transaction; DDL drop/create index là bước riêng, không phải một transaction atomic với email. Nếu một command DDL lỗi có thể còn trạng thái chuyển tiếp; phải inspect lại và lập kế hoạch từ trạng thái thực, không retry mù hoặc coi toàn bộ apply đã rollback. Đây là một lý do shared applier chưa được mở trong script.

**Apply/rollback tự động chỉ tồn tại trên disposable DB do cùng invocation tạo**: `node scripts/review-user-identity.js --apply-disposable`. Factory giữ capability nội bộ theo đúng Db object, tự cấp MongoMemoryReplSet 7.0.14/WiredTiger, chờ PRIMARY, cuối cùng close client/stop replica set. Không nhận ambient URI làm bằng chứng ownership; không có cờ “confirm production” để mở apply shared. Dry-run không cần devDependency MongoMemoryServer; apply-disposable cần devDependencies.

Drill thực chạy bằng `node artifacts/b03/run-index-drills.cjs`, exit 0:

- CLI dry-run trên fixture collision: 1 group, ready=false, không update/drop gì; artifact `dry-run-disposable.json`.
- CLI apply trên replica set tự tạo khác, không collision: normalize 1 email, drop đúng single-name index custom `legacy_display_unique`; thêm display name trùng để mô phỏng đời sống sau migration. Rollback trả `restored:false/DUPLICATE_DISPLAY_NAMES_REVIEW_REQUIRED`; exit 0 của drill **không phải rollback thành công**. Artifact `apply-disposable.json`.
- Tests DB disposable kiểm thêm compound unique mang tên `name_1` còn nguyên, email unique còn nguyên, unknown partial index không bị chạm, stale/collision từ chối mọi apply, reject Db object không do factory tạo; rollback khôi phục spec name:-1/sparse/unique nếu chưa có trùng.

Kế hoạch shared **chỉ để review, chưa thực hiện**:

1. Xác minh môi trường/DB/collection/backup và quyền; tắt autoIndex cho production; ghi snapshot index specification/options, collection collation, topology và unique email index thực tế. Nếu thiếu unique email đơn hoặc chỉ có partial/compound không đảm bảo new writer, dừng và review index riêng sau collision scan, không dựa vào schema. Không dùng syncIndexes/dropIndexes đại trà.
2. Chạy dry-run read-only trước bất kỳ index/data constraint change. Kiểm canonical collision, invalid email, name index và writer đang chạy. Tập collision giữ các ID reference; người quản lý lập manifest quyết định đã xác minh chủ sở hữu/email thay thế, người duyệt, thời điểm và precondition. Không tự gộp account, xóa user/order hay suy ra provider aliases. B03 không cung cấp auto-resolve collision.
3. Chọn maintenance window và pause mọi writer identity (API/worker/admin/script cũ); backup preimages email và full index specs trong kho private, không commit. Quét lại trong cửa sổ đóng writer và đối chiếu manifest. Kết quả trước đó stale phải lập lại. Bộ dry-run hiện đọc projection vào RAM; chưa benchmark trên dataset production lớn.
4. Với approval/manifest không còn collision: giữ unique email index, normalize email từng record bằng CAS _id+old email (transaction/batch có kiểm soát theo khối lượng đã review). Không tự thêm canonical unique/collation index trước scan. Chỉ drop từng candidate name index khi spec/options hiện tại khớp manifest. Index ghép còn giữ có thể vẫn hạn chế tổ hợp trường chứa name; phải review riêng, không coi ready=true là mọi tên trùng đã chắc chắn được phép. Shared applier cần được review/triển khai riêng; không gọi hàm applyDisposable để lách capability.
5. Triển khai code theo thứ tự tương thích, kiểm login exact/canonical/reset và duplicate name; lấy metrics DB/CPU/quota. Chỉ mở writer khi count/invariant/email unique index đạt và smoke test có phê duyệt. Chưa làm bước nào với dữ liệu thật trong B03.
6. Rollback name index chỉ khi kiểm không trùng theo đúng original collation/sparse/options và không có writer chen vào; recreate đúng spec. Nếu đã có tên trùng thì unique index cũ **không thể đảm bảo tạo lại**. Giữ forward-compatible code và xin quyết định; không xóa/đổi tên user để ép rollback.
7. Email rollback không phải hàm tự động của script: dùng private preimages/manifest, CAS chỉ khi email vẫn bằng giá trị migration và uniqueness/collision còn hợp lệ. Không ghi đè email đổi hợp lệ sau đó. Không rollback app về lookup exact-only nếu chưa xác minh khả năng đăng nhập các account đã normalize. Password hash tăng cost vẫn được bcrypt hiện có verify; không hạ cost hoặc khôi phục password/reset token cũ để rollback. Chặn rollback code/schema có thể tái tạo name unique khi dữ liệu mới đã trùng; ưu tiên forward fix dưới review.

## Kiểm chứng và snapshot

- Benchmark CLI đầu và `node artifacts/b03/benchmark-policy.cjs` exit 0; chỉ synthetic/local. Các số CPU/timing không phải test production.
- Selected lần đầu với fixture TLD .test sai bị dừng sau khi xác minh đúng Jest child/parent của phiên (exit 1, không có kết quả pass hợp lệ). Watcher của fixture đã thoát; không kill Node/mongod khác. Lần tiếp theo 54 pass/12 fail/0 skip do hai fixture TLD còn sót và quota client test tích lũy; không gọi đây là lỗi môi trường. Sửa fixture sang example.com và reset đúng key loopback giữa test case, không reset giữa request trong scenario hay nới limiter runtime; rateLimiter.test.js vẫn kiểm quota thật.
- Selected sau sửa: 5 suite/66 pass/0 fail/0 skip, exit 0; tiếp tục đổi scan sang cursor/bổ sung regression rồi chạy lại 5 suite/**70 pass/0 fail/0 skip**, exit 0. Đây là các snapshot trước full cuối, không thay thế kiểm chứng snapshot cuối.
- Full đầu trên B03 (`artifacts/b01/all-MugSAh/`): 56/57 suite pass, **487 pass/1 fail/0 skip**, Jest/runner exit 1, setup thành công. Assertion cũ passwordResetStreams còn đòi 500 cho provider failure trong khi hợp đồng B03 là 200; không gọi đây là lỗi môi trường hay bỏ qua suite. Cập nhật expectation 200 + body bằng request mới thành công, giữ kiểm token mới còn hiệu lực/reset được và thu hồi streams/session; chạy lại full trên snapshot test cuối.
- Full sau sửa expectation (`artifacts/b01/all-qs4hCx/`) đạt 57 suite/488 pass/0 fail/0 skip, exit 0. Sau đó test ranh giới expiry tái hiện lỗi **thật** trên DB đã setup thành công: transaction admission bị trì hoãn qua hạn mà mốc Date cũ vẫn cho 200 (mong đợi 400). Lượt chọn lọc tái hiện exit 1, 1 fail/16 ngoài filter không chạy. Sửa runtime thành server `$$NOW`; chạy lại `node artifacts/b03/run-expiry.cjs` exit 0, 1 pass/0 fail/16 ngoài filter không chạy. Không dùng kết quả 488 test làm bằng chứng cho code sau sửa expiry; chạy HTTP/full lại dưới đây.
- Sau thêm expiry/server-time và đóng cursor tường minh khi dừng scan sớm, full `artifacts/b01/all-nhas02/` đạt 57 suite/489 pass/0 fail/0 skip, exit 0. Rà caller acceptance tiếp tục có regression mới cho query-upsert: `node artifacts/b03/run-expiry.cjs query-upsert` trước sửa exit 1 (1 fail/17 ngoài filter); custom name validator dùng method document trên Query nên upsert không thành công. Sửa validator để phân biệt context; chạy lại exit 0 (1 pass/0 fail/17 ngoài filter), giữ kiểm tên ngắn bị chặn. Lượt 489 test cũng là snapshot trước sửa model cuối, không thay thế full dưới đây.
- Kiểm legacy raw thiếu tokenVersion phát hiện CAS chỉ so số 0 sẽ trả 401 vì default của Mongoose không phải field thực trong MongoDB. Lượt chọn lọc `legacy-without-version` trước sửa exit 1 (1 fail/18 ngoài filter); sửa fence cả rehash/reset để giữ semantics thiếu field=0. Chạy lại exit 0 (1 pass/0 fail/18 ngoài filter), kiểm reset tăng version và revoke token cũ. Đây là lỗi tương thích cần sửa, không phải lỗi môi trường hay lý do buộc migration trước login.
- Các kết quả trung gian và test ngoài filter bên trên chỉ áp dụng snapshot/selection tương ứng, không phải pass của bản cuối. Kết quả chính thức của bản cuối:
  - `npm run test:b01:http` → `artifacts/b01/http-NP2Abm/`: **1 suite/8 pass/0 fail/0 skip**, Jest/runner exit **0**, 35,008 giây.
  - `npm run test:b01` → `artifacts/b01/all-MslS3E/`: **57 suite/491 pass/0 fail/0 skip**, Jest/runner exit **0**, 216,279 giây, Node 24.14.1 Windows. Đếm lại trực tiếp 491 trạng thái passed từ JSON đã lọc.
  - Hai lượt có **cùng 194 file source/test/script/config** và không có hash lệch working tree cuối. SHA-256 của cả hai `source-sha256.json`: `0c8ab3dbab2c15fb62b24adf726777ea63bb29e89c0ca12cfff4e7e43dae7372`. Manifest không bao gồm tài liệu hoàn thiện sau test; không sửa code sau snapshot này.
  - B03 identity integration 19 pass (HTTP app thật/DB thật), migration/index 5 pass (replica set dùng một lần), email logging 1 pass (provider mock). Hồi quy: authBoundary 31, userAuthorization 36 (persistence mock), cookieSessions 2, accountLock 5, passwordResetStreams 2, securityOutbox 3, manager integration 15 + unit 11, reconciliation integration 12, rateLimiter 3; tất cả passed trong full mới. Không đổi lớp mock thành bằng chứng provider thật hoặc HTTP cho mọi endpoint.
  - Baseline full src: statements **69,50%** (3008/4328), branches **63,80%** (1484/2326), functions **67,56%** (427/632), lines **73,27%** (2671/3645). Không thêm threshold hoặc dùng phần trăm làm điểm production readiness; HTTP riêng không instrument subprocess.
  - CLI index dry-run/apply-disposable được chạy lại trên source cuối, exit 0; collision ready=false và rollback duplicate bị chặn như mô tả, không phải apply/rollback shared thành công. Summary/hash source CLI ở `artifacts/b03/final-verification.json`.
  - HTTP/full mỗi lượt dùng Redis primitives/HTTP owner, ID, URL khác nhau; tmpfs/cleaned=true. Docker kiểm tra cuối exit 0, không còn container label harness. Mongo helpers/script tự tạo replica set và await close/stop; không kill process ngoài phiên, không xóa volume dùng chung. Kiểm tra có quyền xác nhận 0 child còn lại của Jest B03 bị dừng ở đợt fixture sai; không dùng kết quả đếm khi sandbox đã từ chối quyền làm bằng chứng cleanup.
  - `node artifacts/b03/verify-final.cjs` và `git diff --check` exit 0. Không chạy lint/build không tồn tại. Không chạy audit fix, migration shared, commit/push/deploy.

## Giới hạn và trạng thái CI

GitHub Actions chưa chạy cho diff hiện tại, CI còn chờ. Không benchmark phần cứng/traffic production, không dry-run/apply shared, không browser E2E hay gửi provider thật. Legacy canonical collision cần manifest, scan fallback O(N), legacy bcrypt dài cần reset; không tuyên bố các điểm này đã giải quyết bằng test local. Nguyên nhân startup Windows B01 ban đầu vẫn chưa xác định; dependency moderate theo biên bản trước chưa được sửa, không audit fix/nâng dependency. Không đưa secret/password/hash hay dữ liệu cá nhân thật vào báo cáo. B03 dừng tại đây sau khi kiểm chứng, không làm B04.

File B03: User model; validationSchemas; userIdentityService/passwordService; authController/userController/sendEmail; scripts benchmark-passwords/review-user-identity và hai caller bootstrap-staging/acceptance-server; tests identityB03/identityMigrationB03/emailDeliveryB03, fixture expectation customerFeatures/userAuthorization/passwordResetStreams và test env; tài liệu B03 và ghi chú UNIFIED-COMMERCE-CONTRACT liên quan. Các diff B01/B02 có sẵn được giữ nguyên; các route, authMiddleware B02 và service commerce/session/revocation không bị B03 sửa.
