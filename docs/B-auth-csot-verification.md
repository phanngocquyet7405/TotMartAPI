# Đợt B — phương án A: CSOT auth 5000ms

Ngày 2026-10-21. Lượt tiền kiểm đầu **BLOCKED do môi trường** như phần lịch sử bên dưới. Sau khi người dùng khôi phục Docker và gõ `tiếp`, đã thực hiện phương án A; kết quả hiện hành nằm ở phần bổ sung cuối tài liệu. Không lấy trạng thái BLOCKED cũ làm kết quả lượt tiếp tục.

HEAD đã xác minh: `62bbb6001728523bf04654bf4aa952f30d99e738`, trùng tag `round-a-checkpoint`. Working tree có thay đổi từ công việc trước; giữ nguyên. Chưa commit, build image, chạy fault hoặc sinh seal trong lượt này. Các kết quả lịch sử không được dùng làm kết quả của phương án A.

## Điều kiện vào và exit code

Kiểm lại từng lệnh ngoài sandbox, không chỉ dựa vào exit code cuối của một khối PowerShell:

- `docker version --format '{{json .Server}}'`: exit **1**, không lấy được Server.
- `docker ps -a --no-trunc --format '{{.ID}} {{.Names}}'`: exit **1**.
- `docker context show`: exit **0**, context `desktop-linux`.
- `git diff --check` trước thay đổi tài liệu: exit **0**.

Hai lệnh Docker đầu đều báo không tìm thấy named pipe `dockerDesktopLinuxEngine` (`The system cannot find the file specified`). Đây là lỗi môi trường, xảy ra cả khi thực thi ngoài sandbox; không phải assertion ứng dụng và không phải lỗi sandbox từ chối quyền. Chưa xác định vì sao daemon/pipe không có. Chưa xác minh được phiên bản Server hiện tại, inventory container/image hiện tại hoặc khả năng tạo fixture. Phiên bản Docker 29.9.1 đã ghi ở lượt trước chỉ là evidence lịch sử.

Cần khôi phục Docker Desktop Linux Engine cho context `desktop-linux`; không có bằng chứng cần cài lại Docker. Chưa dùng mock hoặc Mongo/Redis khác để thay thế. Không tạo tài nguyên Docker nên không có tài nguyên của lượt này cần cleanup; không suy diễn inventory gốc vẫn đủ từ lệnh thất bại.

## Inventory read trước controller — trước khi sửa

Đường `POST /api/checkout/check-out`, theo thứ tự thực thi:

1. Middleware toàn app trong `src/app.js`: cấp requestId, helmet, pino-http, parse body/query, sanitize, CORS, cookieParser, cookie-CSRF. Không có read Mongo trong các bước này.
2. `checkoutLimiter` trong `src/middleware/rateLimiter.js` → `RedisRateLimitStore.increment()` trong `src/services/redisRateLimitStore.js`: Redis EVAL; không Mongo.
3. `authMiddleware.authenticate()` → hàm nội bộ `authenticate()` trong `src/middleware/authMiddleware.js`: `verifyToken`, strict session policy, rồi **User.findById(decoded.userId)**. Kiểm user hiện tại, active, tokenVersion từ DB.
4. Cùng hàm: **AuthSession.exists(...)** khi JWT có sid; ràng buộc sid/userId/tokenVersion/revokedAt/expiresAt. Staging/production strict không cho token thiếu sid vượt qua bước trước.
5. `customerCheckoutMiddleware`: kiểm role lấy từ DB ở bước auth; không read thêm.
6. `validationHandler.validate(checkoutSchema, 'body')`: Joi; không read Mongo.
7. `checkOutController.checkOut()`: bắt đầu controller. Các read từ đây không thuộc patch CSOT pre-controller.

Catch của `authenticate()` hiện gọi `next(error)`; không tự chuyển lỗi DB thành 401. Đây mới là kết luận từ source, chưa có test failpoint mới chứng minh hành vi deadline/fail-closed.

Audit cả middleware inline trong routes tìm thêm **bốn read** trước controller manager (không chỉ quét thư mục `src/middleware`):

- `src/routes/managerRouter.js`: `ownProduct()` → `managerCatalogService.requireProduct()` → `productScope()` → **Brand.find({ ownerId }).select('_id').session(session)**, rồi **Product.findOne(...)**. Áp dụng PUT và DELETE `/api/manager/products/:id` trước `productController.updateProduct/deleteProduct`.
- Cùng router: `ownReferences()` → `managerCatalogService.requireBrand()` → **Brand.exists({ _id: brandId, ownerId })**; có điều kiện khi body có brand.
- Cùng `ownReferences()`: **Category.exists({ _id: categoryId, isActive: { $ne: false } })**; có điều kiện khi body có category. `ownReferences` chạy ở POST/PUT manager products trước product controller.

Tổng inventory: **6 vị trí read** trong đường auth/ownership pre-controller: User, AuthSession, Brand.find, Product.findOne, Brand.exists, Category.exists. Các guard requireAdmin/requireMerchant/requireRole/requireOwnerOrAdmin/adminMiddleware/customerCheckoutMiddleware không có read riêng ngoài authenticate. Các handler cuối inline trong admin/brand/reconciliation routes là controller tại route, không được đánh đồng với middleware chạy trước controller. Chưa sửa các service dùng chung để tránh vô tình áp deadline vào transaction/controller ngoài phạm vi.

`userIdentityService.findForAuthentication()` hiện dùng literal `timeoutMS: 5000` cho exact lookup, canonical cursor và lookup theo ID; chưa tách hằng số dùng chung.

## Phạm vi đo sau auth, chưa thực hiện

Theo source `checkOutController.checkOut()`: replay `Checkout.findOne` ngoài transaction → `checkoutAttemptService.prepare()` đọc `CheckoutAttempt.findOne` và User/address ngoài transaction → transaction prepare/admission → transaction commerce.

Read `Cart.findOne` nằm **trong transaction commerce**, sau attempt lock, replay trong transaction và User.findById trong transaction. Pricing/policy được gọi từ `buildQuote()` trong transaction; không được ghi nhầm thành read trước transaction. Commit prepare và commit commerce là hai điểm riêng. Chưa inject failpoint, chưa đo latency, chưa có kết luận mới về commit unknown hoặc phương án sửa các điểm sau auth.

## Kết quả lượt bị chặn trước khi Docker phục hồi

Test thực chạy: **0 pass / 0 fail / 0 skip**. Test đỏ cho 6 vị trí read và các route đại diện: **NOT-RUN**, chưa viết. Patch hành vi CSOT: **NOT-RUN**. Build image mới: **NOT-RUN**. Outage 45s: **0/3 thực chạy, 3 NOT-RUN**. Snapshot +130s, replay/key mới, bảng so sánh từng request và đo sau auth/commit: **NOT-RUN**.

Worker, regression B01 HTTP/full và seal: **NOT-RUN**, vẫn chờ lần `tiếp` sau theo phạm vi người dùng. Không sửa seal hoặc manifest Đợt A. Không có thay đổi hành vi trong lượt này. File mới duy nhất trong docs là báo cáo này; evidence/manifest của lượt này đặt riêng trong `artifacts/round-b/auth-csot/` và không ghi đè evidence cũ.

Rủi ro còn lại: các read auth và ownership vừa liệt kê chưa có CSOT; tình trạng availability đã xác định ở evidence Mongo trước vẫn chưa được sửa/kiểm chứng. Dừng tại cổng môi trường; cần Docker hoạt động trước khi tiếp tục test đỏ thật rồi mới sửa tối thiểu.

## Bổ sung hiện hành — phương án A sau khi Docker phục hồi

HEAD vẫn `62bbb6001728523bf04654bf4aa952f30d99e738`. Docker Desktop 4.96.0, Engine 29.9.1, Linux/WSL2; không sửa evidence/seal Đợt A. Image cuối build mới từ HEAD cộng working tree: `sha256:7731fc624a71f4535a719a238cb335b19b3a70ea873d5086e670b5732537de43`, tag `totmart-b-candidate:da9c37f9-d8e8-4739-b282-503dad829478-final`. Node trong image v24.22.0, UID 1000, bcrypt load/hash/compare thật đạt; history/layers không có marker fixture hoặc đường dẫn ứng dụng bị cấm. Build/probe/cleanup exit 0. Một image trung gian được giữ lại làm evidence; image cuối được build lại sau sửa định dạng và kiểm hash đủ các file auth/ownership.

Evidence của lượt tiếp tục: `artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/`. Entry lưu inventory tên/ID, source manifest trước sửa, lock hash, HEAD, các hash lịch sử A và candidate trước sửa. Các artifact tiền kiểm BLOCKED được giữ riêng, không ghi đè.

### Thay đổi hành vi

- Thêm `src/config/authReadPolicy.js`: `AUTH_READ_TIMEOUT_MS = 5000`; dùng chung với `userIdentityService.findForAuthentication()`. Login giữ nguyên exact/canonical lookup và policy.
- `src/middleware/authMiddleware.js`: CSOT cho User.findById và AuthSession.exists. Giữ verifyToken, claims, active/tokenVersion/role/sid/expiry/revocation và catch `next(error)`; không đổi DB error thành 401.
- `src/routes/managerRouter.js`: truyền CSOT cho ownProduct/ownReferences và Category.exists; giữ dynamic require Category.
- `src/services/managerCatalogService.js`: nhận readOptions từ middleware cho Brand.find/Product.findOne/Brand.exists. Caller controller/transaction không truyền options vẫn giữ mặc định cũ; không áp timeout vào chúng.

Đây là thay đổi hành vi availability tại biên auth/authorization: read hết hạn trả 503 an toàn và requestId, không vào controller. Không đổi status/code/message 4xx, route, transaction, commit, retry, fencing, idempotency hay timeoutMS ở MongoClient. `src/config/database.js` và các file transaction/commerce khác giữ hash trước sửa. Contract handoff được bổ sung phạm vi deadline từng read, không diễn đạt thành deadline toàn checkout.

### Test đỏ trước sửa và test sau sửa

Chạy qua HTTPS/proxy thật tới hai `node src/server.js` trong cùng image, Mongo replica set và Redis TLS/private CA thật. FailCommand lọc namespace/appName; mỗi ca có server barrier, client deadline 27s, blockConnection 20s và recovery/finally. Bốn route auth đại diện: GET `/api/orders/`, POST `/api/home/logout`, GET admin operations health-summary, GET stream-ticket; mỗi route chặn riêng User rồi AuthSession. Bốn ca manager chặn từng read ownership còn lại. Các session/JWT đều là fixture DB thật, không bỏ strict policy.

- Đỏ trên image trước sửa: **0 pass / 12 fail / 0 skip / 0 not-run**, runner exit 1; các request giữ khoảng 20s rồi controller vẫn chạy. Phân loại: assertion availability ứng dụng. Đây không phải lỗi môi trường.
- Xanh trên image cuối: **12 pass / 0 fail / 0 skip / 0 not-run**, runner exit 0. HTTP 503 trong **5008–5032ms**, body an toàn, header/body requestId khớp; không controller nào được gọi, không mutation manager muộn. Đợi hết sleep server rồi kiểm lại; revoke đúng record sid và access tiếp tục 401 trong cả 12 ca.
- Raw log guard trên image: không có URI/stack/marker fixture; log pino-http/errorHandler được gắn requestId và giữ type/code an toàn.
- Regression chọn lọc userAuthorization/manager.unit/sessionPolicy: cuối **49 pass / 0 fail / 0 skip**, Jest exit 0. Đây là regression có mock persistence, không thay thế 12 ca Mongo thật hoặc B01.

Hai lượt xanh ban đầu bị lỗi harness, đều cleanup 0 và tài nguyên absent. Lượt đầu thiếu checkpoint để xác định chính xác bước lỗi; lượt tiếp có evidence HTTP 503/5025ms và checkpoint `disable-failpoint`: client control socket 8s hết hạn khi configureFailPoint off phải chờ sleep 20s còn chạy. Đã sửa thứ tự recovery, giữ nguyên assertion/deadline HTTP. Client control và backend cũng có appName riêng. Không tính các lượt harness lỗi là BE pass hoặc BE assertion fail.

Regression chọn lọc đầu có 41 pass/8 fail: năm assertion cũ chưa tính options CSOT, ba mock manager chưa có query.setOptions. Cập nhật call signature/query API, giữ nguyên ownership và kỳ vọng 403/404; sau sửa 49/49 đạt. Prettier phát sinh chain xuống dòng bị lint no-unexpected-multiline; dùng biến client trong test để giữ nguyên request/assertion. Không đổi baseline/coverage policy. File format tách khỏi hành vi; verifier so cấu trúc AST sau bỏ metadata và chuẩn hóa ngoặc dư trong chuỗi cùng toán tử logic, giữ toán tử/thứ tự operand, có self-check bắt đổi toán tử/thứ tự.

### Mongo disconnect 45s ×3 trên image cuối

Runner `node tests/helpers/roundB/mongo-evidence-runner.js --auth-csot-45`: exit **0**, availability **3 pass/0 fail**, consistency **3 pass/0 fail**, skip **0**, not-run **0**. Giữ nguyên deadline HTTP checkout 45s. Mỗi lượt topology/namespace/UUID mới; chỉ một fault Mongo, luôn reconnect/recovery/finally.

Fault thực tế **150472–150592ms**; delayed snapshot ở **131052–131088ms** sau reconnect. Sáu checkout đều **503 trong 5007–5016ms**, có requestId, không client timeout. Trace chỉ đi đến auth User read với timeoutMS 5000, không bắt đầu transaction/controller checkout.

Snapshot trước fault = ngay sau reconnect = sau +130s ở cả ba lượt: stock 100, không Checkout/Order/Attempt mới, coupon/events/allocations/refunds/session không đổi. Sau replay cùng key/body qua hai backend: đúng một Checkout/Order/created attempt, stock 99; sau giỏ mới/key mới: đúng hai, stock 98; replay key cũ không thêm nghĩa vụ. Đây là fixture COD chưa paid, không coupon; receipt/allocation/refund bằng 0 đúng state, không chứng minh các nhánh online/coupon/refund khác.

Bảng từng request: [đối chiếu checkout](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/checkout-comparison.csv), [toàn bộ request](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/request-comparison.csv), [từng read trước/sau](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/read-comparison.csv). Ghép theo iteration/backend/method/path/purpose/thứ tự xuất hiện; key/body fixture độc lập giữa hai batch, same-key/body được kiểm bên trong từng lượt. Client timeout cũ vẫn ghi rõ deadline 45s và tách server requestId khỏi header client không nhận được. Request nội bộ chỉ thấy ở server được đánh dấu đúng giới hạn; không giả outcome client.

### Chỉ đo sau auth — chưa sửa BE

Đo 11 điểm trên production fixture cùng image: replay Checkout ngoài transaction; prepare Attempt/User-address ngoài transaction; prepare Attempt trong transaction; commit prepare; replay/User/Cart trong transaction commerce; policy Product và populate Brand; commit commerce. Auth User/AuthSession đã thành công trước lệnh bị chặn, có CSOT 5000ms. Các điểm sau auth không có query CSOT/maxTimeMS; hai commit không có maxCommitTimeMS/timeoutMS được cấu hình ở code gọi.

Mỗi điểm blockConnection 20s, client deadline 45s, topology/namespace mới; snapshot trước/sau phục hồi, same-key/body replay và key mới. Các phép đo một điểm hoàn tất **201 khoảng 20s**, dữ liệu nhất quán; bảng chính xác theo đoạn/requestId tại [after-auth-measurements.csv](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/after-auth-measurements.csv). Đây là latency quan sát dưới fault 20s, không phải upper bound; chưa đo riêng staging hay các nhánh coupon/box tùy chọn, chưa có fault ACK sau commit thật.

Một lượt prepare-address ban đầu mất 40177ms vì mode skip giữ failpoint bật, chặn cả User/address ngoài transaction và User trong commerce, mỗi lệnh khoảng 20s. Evidence hai wireId được giữ nguyên, không gọi đây là retry withTransaction. Sửa harness: control socket riêng đủ chờ recovery, tắt failpoint ngay sau server barrier; guard bắt buộc đúng một command bị chặn. Chạy bù riêng điểm này; verifier dùng lượt một điểm thay cho số đo 40s, không sửa artifact gốc hoặc nới assertion.

Driver thực: Mongoose 8.24.5, MongoDB driver 6.20.0; backend serverSelectionTimeoutMS 5000, socketTimeoutMS 0, waitQueueTimeoutMS 0, pool 20, MongoClient timeoutMS null. Socket 30s chỉ thuộc client điều khiển failpoint trong fixture, không phải backend. `withTransaction` có cửa sổ retry mặc định 120000ms trong driver, không ngắt một await I/O đang chờ; code hiện không truyền budget session/transaction. BlockConnection trước thực thi commit không phải mất ACK sau commit hay UnknownTransactionCommitResult thật.

Phân loại phần còn lại: availability ứng dụng sau auth chưa có giới hạn I/O riêng; không thấy mất/nhân đôi tiền/kho trong phạm vi fixture đã đo. Không áp deadline toàn cục hoặc sửa transaction/commit ở lượt này. Cần người dùng chọn phạm vi tiếp theo:

1. **A1 — chỉ CSOT từng read ngoài transaction checkout** (replay và prepare read). Ưu: thay đổi nhỏ, chưa đụng commit/retry; không tạo write muộn từ chính read bị timeout. Nhược: các read/commit trong transaction vẫn có thể chờ lâu. Lookup timeout vẫn không chứng minh key chưa committed từ lượt trước; tiếp tục recovery bằng cùng key/body.
2. **A2 — budget transaction bằng driver/session CSOT và thiết kế commit recovery**. Ưu: phủ I/O và retry trong transaction theo ngân sách rõ ràng. Nhược: phạm vi lớn hơn, phải kiểm callback/retry/fencing và unknown commit; timeout lúc commit không chứng minh rollback, có thể vẫn committed. Phải giữ cùng key/body và đối soát trạng thái, không trả kết luận thất bại chắc chắn rồi cho dùng key mới. Chưa chốt giá trị budget hoặc sửa code trước quyết định.

### Bàn giao và điểm dừng

File hành vi: authReadPolicy, authMiddleware, userIdentityService, managerCatalogService, managerRouter. File test/tooling: hai regression test, các helper auth-csot/checkout-wait, observer/topology/image-fixture, mongo-evidence client/runner, builder và verifier. Tài liệu: báo cáo này và contract handoff. Bản đầy đủ từng file, bản trước sửa/behavior trước format/final format, kèm hash nằm trong `full-files/` và `file-delivery.json` dưới thư mục evidence; không chỉ giao patch rời.

Các gate của phạm vi auth và outage đã đạt; phần sau auth chỉ đo, chưa sửa và chờ quyết định. Worker, regression B01 HTTP/full và seal vẫn **NOT-RUN**. Không commit/push/deploy, không sinh seal, không sửa FE hoặc evidence lịch sử A. Verifier của nhiệm vụ exit **0**: **135 container/network/probe ID do lượt này tạo đều absent**, bốn container gốc và các image tag/ID đầu vào vẫn đủ, hash lịch sử A không đổi. Hai image candidate mới có UUID label được giữ để review/kiểm chứng tiếp; không thuộc mục tiêu cleanup container/network.

Kiểm tra cuối: `npm run lint` exit **0** (19 lỗi nợ cũ, 0 vi phạm mới); `npm run format:check` exit **0**; `npm run validate:api` exit **0**; `git diff --check` exit **0**. Không có coverage run của lượt này; coverage/cleanup/Jest của B01 **NOT-RUN**, không mượn số liệu B01 lịch sử. Phép đo bù User/address: **201/20118ms**, đúng một command bị chặn; 11 phép đo hợp lệ nằm trong **20118–20248ms**, mỗi điểm giữ một nghĩa vụ rồi replay/key mới đúng. Đây là kết quả đo, không phải 11 assertion availability đã xanh.

[task-verification.json](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/task-verification.json) và [full-files.zip](../artifacts/round-b/auth-csot/f7350f79-2055-4f83-b701-6a86fd08d30c/full-files.zip) là báo cáo/xuất file của nhiệm vụ, không phải seal Đợt A/B. Dừng sau báo cáo, chờ lựa chọn và `tiếp`.

## Đính chính ở lượt A1 tiếp theo

Tiêu đề “Mongo disconnect 45s ×3” ở trên dùng tên variant theo **deadline client 45s**, không phải thời lượng mất kết nối. Raw runner đặt cửa sổ giữ fault **150000ms**; ba khoảng disconnect hoàn tất → reconnect hoàn tất đo được 150592/150490/150472ms. Snapshot ngay sau reconnect nằm ở +1760/+1359/+1262ms; snapshot muộn ở +131052/+131088/+131065ms, sau đó mới replay. Không sửa report, request CSV hoặc seal/manifest lịch sử. Timestamp là mốc quan sát command, không phải đo packet-level. Đối chiếu/hash raw và inventory A1 bổ sung tại [B-a1-verification](B-a1-verification.md).

Các số 12/12 Mongo thật và 49/49 regression ở báo cáo này chỉ thuộc phạm vi auth. Chúng không thay cho gate worker, B01 HTTP/full/coverage/cleanup của lượt A1 tiếp theo.
