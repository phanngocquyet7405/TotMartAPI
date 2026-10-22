# Đợt B — A1: read checkout ngoài transaction

Cập nhật 22/10/2026: ngoại lệ hai index identityMigrationB03 đã được duyệt và kiểm chứng; B01 full709/709, ledger300007 và A2-0 hai ca đã chạy. Xem [báo cáo lượt tiếp](B-a2-0-verification.md). Các trạng thái BLOCKED/NOT-RUN bên dưới là lịch sử A1; P1 transaction/commit vẫn mở, chưa làm A2-1/A2-2 hoặc Đợt C.

Trạng thái đang kiểm chứng, chưa kết luận Đợt B đạt. HEAD đầu lượt `62bbb6001728523bf04654bf4aa952f30d99e738`; working tree có thay đổi từ lượt auth và được giữ nguyên. Docker Desktop 4.96.0 / Engine 29.9.1, Linux/WSL2. Không bắt đầu Đợt C, không commit hoặc sinh seal.

Evidence riêng: `artifacts/round-b/a1/0b58daac-d290-49af-9f95-a5b0b566448b/`. Source manifest trước sửa, hash lockfile, candidate trước sửa và hash evidence A nằm trong entry. Không sửa evidence A hoặc artifact auth cũ.

## Đính chính nhãn lịch sử “outage 45s ×3”

Đối chiếu report gốc `artifacts/round-b/auth-csot/outage45/56919647-e3ca-485b-9571-78e6a63e3bd3/report.json` và runner cho thấy **45s là deadline HTTP client**, không phải thời lượng mất kết nối. Runner đặt riêng `faultWindowMs:150000`, bắt đầu đếm sau khi lệnh disconnect hoàn tất; chờ hết cửa sổ này rồi mới reconnect trong finally. Đây là fault giữ 150s, không phải ba outage 45s.

- Lượt 1: disconnect yêu cầu `1792590947382`, hoàn tất `1792590947836`, reconnect hoàn tất `1792591098428`: chênh **150592ms**. Snapshot ngay sau reconnect +1760ms; snapshot muộn +131052ms.
- Lượt 2: yêu cầu `1792591293535`, hoàn tất `1792591293918`, reconnect `1792591444408`: **150490ms**. Snapshot +1359ms và +131088ms.
- Lượt 3: yêu cầu `1792591640970`, hoàn tất `1792591641491`, reconnect `1792591791963`: **150472ms**. Snapshot +1262ms và +131065ms.

Timestamp sau lệnh Docker được lấy từ client container; đó là mốc quan sát lệnh hoàn tất, không xác định thời điểm mất packet chính xác. Reconnect network chưa chứng minh Mongo đã phục vụ: snapshot ngay còn cần ping/read, health recovery được kiểm riêng; snapshot muộn chờ ít nhất 130s tính từ reconnect, rồi mới replay cùng key/body và giao dịch mới. Cleanup xảy ra sau recovery. Báo cáo cũ ghi đúng số đo 150s trong nội dung nhưng tiêu đề gây hiểu nhầm; bổ sung này đính chính nhãn, giữ nguyên raw evidence. CSV/JSON đính chính kèm hash raw tại evidence mới.

## Inventory A1 trước sửa

Đường tạo sản phẩm: `/api/checkout/check-out` → checkoutLimiter (Redis) → authenticate (User/AuthSession đã CSOT 5000ms từ lượt trước) → customerCheckoutMiddleware (role DB đã nạp) → Joi → checkOutController.checkOut → replay → prepare → transaction commerce. Đường subscription giữ nguyên tên `subcribe`, dùng userSubscriptionController.subscribeToTemplate → replay → prepare. Hai route `/api/checkout/attempts/products/prepare` và `/api/checkout/attempts/subscription/prepare` gọi cùng replay/prepare sau authenticate/role/validation.

Bốn vị trí read ngoài transaction thuộc A1:

1. `checkoutLifecycle.replay`: **Checkout.findOne**, khi không có session. Bao gồm lookup đầu create/prepare và lookup phục hồi lỗi 11000 của controller sản phẩm/subscription. Khi có session, read trong transaction giữ nguyên options.
2. `checkoutAttemptService.prepare`: **CheckoutAttempt.findOne** đầu hàm, cả hai kind.
3. Cùng prepare: **User.findById** để snapshot địa chỉ, chỉ products.
4. Cùng prepare: **CheckoutAttempt.findOne** trong catch 11000 sau transaction prepare, cả hai kind. Không bỏ sót nhánh này vì ít gặp.

Không thuộc A1: read/commit có session trong prepare, lock attempt, replay/User/Cart/pricing/Product/Brand/Coupon/BoxVersion và ghi commerce trong transaction; resolve/terminate attempt chạy transaction; read của quote/poll/list/admin/cancel không thuộc đường tạo nghĩa vụ đã chọn. Không đặt timeout toàn MongoClient. Timeout lookup không chứng minh key chưa committed: tiếp tục cùng key/body, không hướng dẫn đổi key để khôi phục request chưa xác định.

## Test và kết quả

Đang chạy test đỏ trước sửa BE trên image auth hiện tại. Bốn vị trí có failCommand thật, namespace/appName fixture, blockConnection 20s, server barrier, client deadline 30s, recovery/finally. Nhánh catch dùng một lỗi duplicate 11000 do Mongo server inject vào insert prepare, tiếp theo mới chặn read phục hồi; hai fault nối tiếp, không đồng thời. Đây là kiểm nhánh lỗi server-injected, không tuyên bố đã tái hiện race unique tự nhiên hoặc unknown commit/lost ACK.

Lượt đầu nhánh catch là lỗi harness: failCommand thiếu extra info bắt buộc của DuplicateKey, Mongo trả code 40671 thay 11000, nên không đi vào catch cần kiểm; barrier sau đó hết hạn code 50. Giữ artifact này, không tính là test đỏ availability hợp lệ. Sửa cấu hình fault theo [source MongoDB 7.0.14](https://raw.githubusercontent.com/mongodb/mongo/r7.0.14/src/mongo/db/commands.cpp): cung cấp errorExtraInfo và nhắm insert Attempt; không thay assertion HTTP/5s/snapshot. Cleanup lượt lỗi exit 0, tất cả fixture absent.

### Thay đổi hành vi A1, tách khỏi tooling/format

Chỉ sửa `src/services/checkoutLifecycle.js` và `src/services/checkoutAttemptService.js`. Dùng hằng số `AUTH_READ_TIMEOUT_MS` đã có, áp `query.setOptions({timeoutMS:5000})` cho đúng bốn vị trí trên. Replay chỉ đặt options khi không có session. Không đổi transaction callback, commit, retry, revision/fencing, idempotency, route hoặc 4xx. Không thêm Promise.race/timeout response để bỏ lại transaction chạy nền. Bản trước sửa, behavior trước format và file cuối được xuất riêng; AST kiểm format và phần transaction không thay đổi.

Image mới từ HEAD cộng working tree: `sha256:1b99bfd6902d2020ba0d980847f3c80d7b3ca1a2456db97314968428d8c5f991`, tag `totmart-b-candidate:ebadaaf8-1a8f-47d9-9f15-e2bdac47be94-final`, Node 24.22.1, UID 1000. Build/native bcrypt/hygiene/runtime source hashes/probe cleanup đều exit 0. Image auth cũ `7731fc6...` giữ nguyên cho bằng chứng đỏ. Docker vẫn Engine 29.9.1; không sửa seal A.

Đỏ hợp lệ trước sửa: **0 pass / 4 fail / 0 skip**, ghép ba ca đầu ở `red-0e14a48e-8414-4f71-b735-212f6fc46f68` và ca catch đã sửa cấu hình harness ở `red-c1299298-76a8-4c7e-8098-09a17b8c4ee0`; cả hai runner exit 1, cleanup 0. Ba ca đầu trả 201 sau 20152/20125/20166ms; ca catch trả 500 sau 20123ms. Đây là assertion availability ứng dụng, không phải môi trường; các giao dịch 201 vẫn nhất quán, không phải bằng chứng double obligation.

Xanh trên image mới: **4 pass / 0 fail / 0 skip / 0 not-run**, runner/cleanup exit **0**, tại `green-35efb81f-13d0-45ab-b03f-69d259de972b`. Từng read lần lượt trả **503/5055ms**, **503/5064ms**, **503/5066ms**, **503/5103ms**, header/body requestId khớp. Observer chứng minh read ngoài transaction có timeoutMS 5000 và kết thúc bằng MongoOperationTimeoutError; không có query/insert/update/commit tiếp theo từ request sau read lỗi. Log guard quét raw log trước khi lọc; không có marker credential/URI/stack bị công bố. CSV từng request trước/sau được verifier sinh tại `read-comparison.csv`.

Snapshot A1 chụp sau khi failpoint sleep 20s đã kết thúc (ít nhất khoảng 20.3s từ bắt đầu), không đổi so trước fault: stock 100, không Checkout/Order/Attempt mới, coupon/ledger/session giữ nguyên. Đây **không phải** snapshot +130s mới; snapshot +130s ở phần đính chính là evidence auth lịch sử và không dùng thay phạm vi A1. Sau recovery: cùng key/body qua hai backend có đúng một checkout/order/created attempt, stock 99; mua độc lập key mới có đúng hai, stock 98; replay key cũ không tiêu thụ giỏ mới. Fixture A1 là COD không coupon, nên không suy kết quả này sang mọi nhánh online/coupon/box/subscription; worker và B01 là gate riêng.

### Worker: lỗi harness được giữ lại

- `workers-79f24e93-28a0-4b21-a847-7322a5ead558`: runner 1, backend kill/restart pass, expiry chưa chạy drain do helper chỉ cho transfer `.js`. Phân loại harness. Bổ sung command JSON giới hạn UUID/id/action/worker, ghi atomic và kiểm SHA; không mở đường ghi ngoài `/fixture`, không đổi assertion.
- `workers-2b86cd2d-37e9-47dc-b354-5a4a6640d2a3`: runner 1, command consumer xóa file trước kiểm SHA sau transfer. Phân loại race harness; sửa consumer chỉ nhận mỗi UUID một lần và giữ immutable bytes đến cleanup.
- `workers-1d2c8e4b-9212-4d2e-8537-0ce67881be01`: backend và expiry pass, paid-check đỏ. Chưa kết luận dữ liệu sai; dừng worker còn lại và thu lại đúng ca đỏ trước khi sửa.
- `workers-1a3e86a3-20e0-4dd9-879f-f015f146a803`: giữ nguyên assertion, thêm actual/expected và failure snapshot. Actual allocation **300007**, expected sai **300000**. Snapshot: receipt processed/applied 300007, một allocation 300007, checkout/subscription paid/active, một surplus refund 7 **pending**, stock 100, fulfillment 0. Source `applyReceipts` và hợp đồng B06 đoạn conservation quy định allocation giữ cả receipt; surplus là nghĩa vụ nằm trong khoản đó, không cộng lần hai. Phân loại **harness — kỳ vọng ledger sai**, không phải lỗi môi trường hoặc mất tiền. Sửa kỳ vọng về đúng 300007 và bổ sung phương trình `receipt = allocation = principal 300000 + pending surplus 7`, kiểm không có completed refund. Không sửa BE/luồng tiền.

Mọi lượt lỗi trên cleanup exit 0, tài nguyên đã absent. Các ca mới chạy cùng image A1; real `server.js` dùng cấu hình DB thực, không thay socket/server selection timeout. Preload chỉ điều khiển timer fixture và gọi exported drains thật, có barrier/deadline. Không dùng kết quả này để khẳng định cadence cron tự nhiên; kill worker rồi chờ lease hết hạn không chứng minh old worker resume.

### Ngoại lệ cleanup index được người dùng duyệt

Chỉ `b03_owned_legacy_display_fixture` do test B03 của lượt này tạo trên MongoMemoryReplSet riêng. Trước create kiểm index chưa tồn tại; trước drop xác minh cùng connection/client, loopback port do helper tạo, processId từ hello, database, collection users, UUID marker và name/key/unique `{name:1},true`. Không khớp thì throw trước drop. Sau drop kiểm absent, lưu `b03-index-resource.json`. Không dùng dropIndexes/syncIndexes hoặc xóa index khác. Đây là tooling/fixture cleanup theo ngoại lệ cụ thể, không đổi policy identity/runtime index.

## Kết quả cuối và cổng dừng

**A1 đạt; Đợt B chưa đạt; chưa đủ điều kiện Đợt C.** Không commit/push/deploy hoặc seal. Evidence mới và full-file exports nằm trong thư mục A1 nêu đầu báo cáo; raw evidence A/auth được giữ nguyên.

### Worker và regression

Ma trận `worker-matrix.csv` được verifier tổng hợp theo scenario, không cộng retry thành test độc lập: **5 nhóm worker pass/0 fail/0 skip/0 not-run**, cộng backend kill/restart smoke pass. Mỗi ca có image A1, UUID riêng và cleanup0:

- Backend và expiry đạt ở `workers-1d2c8e4b-9212-4d2e-8537-0ce67881be01` (hai ca pass; runner tổng1 vì bước payment sai kỳ vọng sau đó). Survivor replay giữ một order/stock99. Expiry rollback fault sau save, restart rồi hai instance chỉ hủy/nhả coupon một lần.
- Payment/delivery/notification đạt ở `workers-51d5a6e3-c292-4db9-ab4c-8c48aae95301` (ba pass; runner tổng1 do watcher security harness). Payment phục hồi receipt retry sau allocation failure/restart, một allocation/surplus đúng conservation. Delivery không tạo trước paid, post-upsert fault/restart vẫn một fulfillment, chưa trừ stock trước dispatch. Notification giữ claim qua kill, chờ lease **tự hết hạn**, retry/backoff theo nextAttempt thật, pending0 và một notification theo eventKey. Không chỉnh lease/nextAttempt trong DB để nhận kết quả này.
- Security đạt ở `workers-73304d1e-d2e3-48cc-b3f6-dc897aef2bf7`, runner0. Watcher cũ gọi duplicate trên wrapper không có API đó; barrier chưa mở nên chưa gây fault. Sửa bằng Redis TLS client fixture riêng, không đổi assertion/BE. Quan sát publish-before-marker, kill PID1 exit137, restart/chờ lease tự hết hạn; transport giao hai lần, một event published, pending0.

Các lỗi worker trước là harness, không phải môi trường hay lỗi mất tiền. Ca allocation đỏ được thu lại giữ nguyên assertion: actual300007/expected300000; receipt300007 = allocation300007 = principal300000 + surplus7 pending, đúng source và conservation contract B06. Đã sửa kỳ vọng sai và thêm phương trình/pending-vs-completed, không sửa BE. Tất cả runner lỗi vẫn giữ artifact và cleanup0.

Preload chỉ điều khiển timer fixture và gọi drains thật của hai server.js; không đổi DB timeouts. Không suy kết quả thành cadence cron tự nhiên, mọi quan sát SSE/limiter khi kill hoặc old worker resume. Natural expiry sau kill chỉ chứng minh phần đó, không đóng ca PROD old-worker resume.

Selected regression B03/DB helper: `node tests/helpers/roundB/a1-index-regression.js`, **24 pass/0 fail/0 skip**, Jest0, hai suite; coverage NOT-RUN, không phải B01 full. Artifact `index-regression-iqU0RL/`. Index ngoại lệ đã thực chạy ở lượt selected: UUID `9e202bad-a0a3-4558-9369-b74010d1d05c`, Mongo processId `6ad8def8370a9664b3a594d3`, database `test`, collection `users`, port53095. Pre-delete xác minh đủ instance/database/collection/name/key/unique; cleanup0/index absent. Sau teardown, port fixture ECONNREFUSED (`index-mongo-cleanup-check.json`).

`npm run test:b01:http`: **16 pass/0 fail/0 skip**, một suite, Jest0/runner0/cleanup0. Coverage gate N/A ở mode HTTP (`coverageExitCode:null`, vẫn có coverage artifact). Evidence mới `artifacts/b01/http-WplDkK/`, Windows Node24.14.1, Mongo/Redis thật riêng. Không thay bằng auth12/12, mock49/49 hay số liệu lịch sử. BE/assertion của run HTTP không đổi trong sửa verifier/docs sau đó.

### B01 full — BLOCKED trước thực thi

`node tests/helpers/roundB/a1-full-preflight.js` native exit **2**, đo bằng `exit $LASTEXITCODE`; lần đầu PowerShell normalize thành tool exit1, không phải Jest fail. Không khởi động npm full, không skip hoặc sửa hai test.

Call graph: `tests/identityMigrationB03.test.js` → `applyDisposable` → `scripts/review-user-identity.js:67` → `collection.dropIndex(index.name)`. Hai ca thành công xóa **legacy_custom_display** và **custom_display_desc** trong apply migration, nằm ngoài ngoại lệ cleanup index duy nhất người dùng duyệt. Full **BLOCKED/NOT-RUN toàn gate**, pass0/fail0/skip0; Jest/runner/coverage/cleanup NOT-RUN, không tạo resource full. `b01-full-preflight.json` lưu hash/source/tên workflow. Không tự mở rộng ngoại lệ hoặc đổi tên index để lách.

Full coverage chưa chạy nên không báo pass hoặc fail. Preflight hash cho thấy checkoutAttemptService và managerCatalogService cần review theo policy source đã đổi; khi full được phép vẫn phải qua gate thực. Không đổi lint/coverage baseline, instrumentation hoặc ngưỡng.

### P1 còn mở và A2 chưa được phép triển khai

**P1 availability core checkout vẫn mở**, không hạ mức để khép B; chưa có money/stock P0 được chứng minh. Read có session/commit trong prepare và commerce (lock Attempt, replay/User/Cart/pricing/Product/Brand/Coupon/BoxVersion) chưa có budget driver/session/maxCommitTimeMS. Subscription create tương tự. Inventory source còn gồm resolve/terminate attempt, checkout cancel/confirm-COD/resolve-inventory, subscription cancel/fulfillment, payment command và expiry. Từng call nằm ở `unbudgetedTransactionCalls` trong verifier; không suy tất cả đã được fault-test mới.

Runtime giữ Mongoose8.24.5/driver6.20.0, selection5000/socket0/waitQueue0/MongoClient timeoutMS null. Evidence sau-auth cũ đo block20s trong transaction/commit cho HTTP khoảng20s; callbacks không đổi trong A1 và được so AST/source. **Không chạy lại 11 phép đo đó trên image A1**, không gọi chúng là upper bound hoặc lost ACK. Retry window120s không phải deadline ngắt await I/O. P1 là availability/recovery đường mua hàng khi commit chưa rõ, chưa có owner risk acceptance.

A2 cần duyệt riêng: chọn budget session/driver cho prepare và commerce, phân bổ retry/commit; giữ atomicity/fencing và recovery cùng user/kind/key/body, không Promise.race để transaction chạy nền. Test đỏ read/write/commit trước sửa. Hai chứng cứ riêng bắt buộc: **server-injected UnknownTransactionCommitResult** và **mất ACK Mongo sau commit thật**, có observer độc lập chứng minh commit trong lúc reply Mongo bị giữ/mất, rồi replay chỉ một nghĩa vụ. HTTP response loss hoặc kill trước commit không thay cho chúng; timeout không chứng minh rollback để mở key mới. Hai ca đó, multi-node failover và natural expiry **kèm old worker resume** vẫn NOT-RUN trong A1.

### Exit/cleanup/file bàn giao

Inventory, timeline audit, build, green A1, selected regression, B01 HTTP lần cuối exit0. Hai runner đỏ A1 exit1 chứng minh thiếu budget; các runner worker lỗi harness exit1 được giữ và phân loại ở trên. Quality đầu có unused import/format cần chạy lần hai; đã sửa tooling/format, không đổi assertion/baseline. Chuỗi quality đầu không thu exit riêng nên không dùng nghiệm thu; wrapper cuối ghi riêng: **lint0, format:check0, validate:api0**, lint18 debt/0 violation mới, API11 operations/8 examples. `git diff --check` kiểm riêng cuối. Không lấy lint:all debt/full coverage chưa chạy làm pass.

Delivery verifier đầu exit1 do nhận nhầm pointer red-latest.txt là directory; sửa filter, giữ assertion rồi exit0. Verifier xác nhận **157 container/network/probe ID absent** bằng inventory độc lập, bốn container gốc và toàn bộ image tag/ID đầu vào nguyên vẹn, hash evidence A/raw timeline không đổi. Candidate A1 có label UUID được giữ cho review. Index absent/MongoMemory selected đã teardown/port đóng; HTTP resources cleanup0 và absent.

`file-delivery.json` và ZIP cuối chứa đầy đủ file, tách behavior trước format, format cuối, tooling/docs. Chỉ hai file BE thuộc hành vi A1; source auth/logger từ lượt trước giữ hash. Các thay đổi test/helper/runner là tooling; nguyên bản trong `before/`. Không sửa FE/.env/evidence A hoặc policy gate. **Dừng tại full bị giới hạn quyền và P1 transaction/commit; trình A2/phạm vi B01 full cho review, chờ “tiếp”, không tự sang Đợt C.**
