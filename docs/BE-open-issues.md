# BE open issues và quyết định cần owner — 20/10/2026

Lượt đóng Đợt B theo yêu cầu mới: [báo cáo và verifier seal](B-close-verification.md). **B-A1-AV01 vẫn là P2 còn mở**, theo văn bản do owner cung cấp nguyên văn ở cuối hồ sơ; đóng phạm vi kiểm chứng local không phải sửa budget hoặc cho phép staging người dùng thật/mở bán. Các P2 khác không tự được đóng hay chấp nhận thêm.

Cập nhật theo quyết định owner **Q, ngày 22/10/2026**: **B-A1-AV01 hạ P1→P2, còn mở; chấp nhận rủi ro có điều kiện** theo hồ sơ cuối trang. Không phải lỗi đã sửa hoặc chấp thuận staging/mở bán. [A2-0](B-a2-0-verification.md) giữ nguyên evidence; A2-1/A2-2 chưa chạy, không tự vào Đợt C.

Phần B08 dưới đây là lịch sử trước quyết định Q ngày22/10/2026: candidate B08, self-review/source và bằng chứng local. Không có reviewer độc lập thực sự trong phiên đó. Kết luận không thấy P0/P1 trong phạm vi đã rà và chưa có owner nhận rủi ro ở thời điểm B08 không thay thế hồ sơ hiện hành B-A1-AV01 cuối trang. Các vai trò đề xuất cho vấn đề khác chưa phải giao việc hoặc phê duyệt.

## Phát hiện đã đóng trong phần khép B07

- **B07-E01 — P1, cổng bằng chứng có thể false-positive.** Verifier ignored cũ chỉ rehash path đã liệt kê, bỏ sót file mới và không bắt buộc archive/đối chiếu checksum. Trigger: thêm source ngoài manifest hoặc archive khác/mất nhưng metadata còn xanh; ảnh hưởng: nghiệm thu sai snapshot/restore chain. Source gốc giữ tại `artifacts/b07/verify-final.cjs`; archive mismatch thực tế đã được tái tạo trong `artifacts/b08/archive-investigation.json`. Đã thay bằng verifier tracked, complete path sets, mandatory artifacts, status recount và exit/cleanup/coverage checks. Regression fixture trong `tests/evidenceVerification.test.js`; không phá archive lịch sử. CI candidate được bổ sung bước gọi verifier; remote execution còn chờ.
- **B07-E02 — P2, checksum sai biểu diễn và thiếu chuỗi restore retained file.** `sha(Buffer)` cũ hash EJSON, không phải byte file; chính file hiện tại tái tạo đúng cả hai digest. Restore cũ dùng bản container, chưa so host copy. Đã chạy mới actual dump/restore retained-host-file → container với bốn hash raw trước/sau, namespace mới/empty, không --drop; kiểm documents/indexes/ledger/session/replay/tombstone. Biên bản B07 giữ nguyên số liệu/hashes lịch sử và ghi phần bổ sung hiện hành.
- **B07-E03 — P2, kế hoạch max20 nhưng đo40.** Không tìm thấy amendment trước run cũ. Giữ sai lệch lịch sử; công bố profile40/concurrency2/max30s/route mix/dataset/warmup/stop trước lượt mới và chạy lại. Không đổi tiêu chí hoặc runtime timeout sau khi xem kết quả.

## P2-01 — Password legacy và phần UX chuyển đổi chưa hoàn tất

Trigger: account bcrypt legacy nhập hơn72 UTF-8 byte, hoặc form register/reset gửi input vượt policy mới. BE vẫn verify legacy và trả notice; không thể phục hồi bí mật suffix mà bcrypt cũ không lưu. `src/services/passwordService.js`, `src/controllers/authController.js`, `tests/identityB03.integration.test.js` chứng minh đường legacy/byte-limit, không phải mọi account thật đã được reset.

Đối chiếu FE chỉ đọc: login page lưu token/điều hướng mà chưa thấy xử lý passwordChangeRequired/reason; register chỉ kiểm min8, PasswordRecovery.jsx chỉ minLength8 và coi mọi reset400 là link hết hạn. Reproduction ở mức hợp đồng: password invalid400 có thể xảy ra trước tiêu thụ reset token; nhãn “link hết hạn” của FE không đúng cho mọi400. Chưa chạy browser để xác nhận UX thực tế. BE vẫn chặn input mới và bảo toàn token; không nới policy.

Đề xuất owner: security/product cùng FE. Cần xác nhận UX reset chủ động, thông báo lỗi/byte-limit và hỗ trợ account legacy. Regression đợt FE: Unicode72/73 byte, invalid password với reset token còn hạn rồi reset hợp lệ, notice login legacy, logout/session revocation sau reset. Không sửa FE trong nhiệm vụ này.

## P2-02 — Email legacy/index cần quyết định và đo dữ liệu đích

Trigger: exact email miss cần canonical fallback, legacy canonical collision, hoặc unique display-name index cũ còn trên DB. `userIdentityService.canonicalMatches` scan cursor projection theo JS trim/lowercase; ambiguity từ chối chung, không đoán owner. `review-user-identity.js` chỉ cấp apply/rollback capability cho DB cùng invocation tự tạo. B03 tests/drill có collision/stale/index/duplicate rollback thực trên fixture; chưa có inventory dữ liệu production.

Ảnh hưởng đã xác định: fallback có thể đọc O(N); display-name registration có thể503, index rollback bị từ chối khi đã có tên trùng. Chưa chứng minh timeout hay collision cụ thể trên dữ liệu thật, không gọi đó là outage đã tái hiện. Đề xuất owner: backend/database và người quản lý identity. Cần manifest quyết định từng collision, index specification, writer quiescence và benchmark đích trước triển khai shared applier. Không tự merge/rename account/drop index hoặc nhận ready=true là approval. Regression: giữ exact legacy priority, ambiguous refusal, new canonical uniqueness và CAS/index option guards.

## P2-03 — Missing preimage rollback thành null

Cập nhật C1, 22/10/2026: script chuyển manifest version2 có physical preimage `{exists,value}`, validation trước transaction, legacy thiếu version/preimage bị từ chối; rollback CAS phục hồi absent/null/false/value trên clone. Có ca crash child sau ghi thật trong transaction và writer chen vào; không ghi đè writer hoặc đụng tài chính/tombstone/session. Xem [C1 verification](C1-verification.md). Lỗi tooling này được sửa và kiểm trên fixture, **chưa rollout migration shared**; owner database/backend vẫn cần review manifest/dataset/backup trước apply. Mô tả trigger và evidence B07 bên dưới là lịch sử, giữ nguyên.

Trigger: commerce-integrity manifest ghi before bằng null cho field vốn absent. Apply rồi rollback ghi `$set:null`; không khôi phục physical field absence. Source `scripts/migrate-commerce-integrity.js`; B07 migration-cas đã assert subscriptionOnly trở thành null, writer edit vẫn được giữ bằng CAS, protected finance/session/tombstones không đổi.

Ảnh hưởng: code/query phụ thuộc `$exists` có thể thấy khác sau rollback trên dataset có field thiếu. Không có shared apply trong phiên. Đề xuất owner: database/backend migration reviewer. Cần quyết định có yêu cầu presence-preserving manifest version mới hay chỉ chấp nhận value semantics cho dataset được duyệt. Phải kiểm preimage/index/consumer trước rollout; không tự thay format lịch sử hoặc bulk unset. Regression nếu làm mới: absent/null/false phân biệt, stale/writer-CAS, transaction interruption và ledger/session/reference fingerprints.

## P2-04 — Alert adapter chưa được wire production

C1 kiểm thêm persisted pending/restart, lost ACK/dedup, source transport failure và external watchdog tới sink loopback. Adapter hiện **chưa có dead-man tích hợp và chưa có production wiring**; watchdog C1 chỉ là fixture. Summary chưa phủ route latency/p99, in-flight purchase, sustained readiness not_ready hoặc tuổi attempt processing quá ngưỡng; attemptGrowth/capacity không thay thế tuổi attempt. Chỉ đề xuất platform/BE instrumentation + scheduler/state/watchdog độc lập, finance/security theo queue; channel/on-call/threshold/SLO cần owner. Không sửa src để tự thêm các tín hiệu trong C1. Xem [runbook](C1-mongo-silent-runbook.md).

Trigger: backlog/refund/capacity vượt ngưỡng trong deployment mà không có scheduler/source-reader/sink/state-store thực. `scripts/dispatch-operations-alerts.js` là adapter opt-in; `src/server.js` chỉ khởi động năm nhóm business/security workers, không wire alert dispatcher. Local HTTP summary→adapter→sink đã chứng minh firing/recovery/retry/coalescing, không chứng minh người trực nhận được cảnh báo.

Đề xuất owner: platform/backend, finance cho refund và product/security cho attempt capacity. Cần chọn authenticated reader, TLS sink/idempotent delivery, persistent state, dead-man/source-reader failure alarm, lịch chạy/retention, người trực và thời gian phản hồi. Các ngưỡng15min/24h/8000/10000 là đề xuất, chưa được ký SLO. Regression sau wiring chỉ trên môi trường được duyệt: sink lỗi/timeout/lost response, restart/state replay, stale source, capacity không xóa tombstone. Không gửi thông báo thật trong phiên này.

## P2-05 — Hạn chế response contracts và lint debt

OpenAPI/Ajv hiện là11 operations/8 examples; B05 supplement có actual-response assertions cho login/refresh/attempt/admin refund ở các status đã ghi. Còn thiếu machine schemas/assertions cho đầy đủ subscription result, mọi attempt/error branch, webhook, locked403 và auth429/503, nhiều manager/catalog operations. Không suy HTTP business pass thành schema coverage toàn API. Source/spec/examples và `tests/apiContract.test.js` là bằng chứng phạm vi này.

Lint toàn source vẫn19 lỗi baseline/0 warnings; gate chỉ cho phép debt trên LF-hash cũ, file mới/đổi phải sạch. Baseline/rules không sửa. Đề xuất owner: BE API/QA và maintainer. Cần ưu tiên branch/contract theo risk thay vì tăng test count hoặc % toàn repo. Regression cần bổ sung khi mở phạm vi: response thực và negative schema đúng operation/status, giữ business assertions. Debt cleanup là đợt riêng, không disable rule/đổi baseline để nhận điểm.

## P2-06 — Refresh retry là tradeoff, browser/clock chưa được nghiệm thu

Trigger: nhiều tab, response Set-Cookie về sai thứ tự, token consumed quá30s/successor tiến tiếp hoặc drift đồng hồ instance. Policy hai duplicate/<30s/current-successor/cap4096/family30d đã test real Mongo/Redis/hai process. Nó cho phép holder token cũ trong cửa sổ và có thể logout retry hợp lệ đến muộn. Đây là hành vi policy đã công bố, không phải lỗ hổng mới tự suy đoán.

Đề xuất owner: security/backend và FE. Cần xác nhận tradeoff và cơ chế browser coordination; giữ stable refresh secret, clock sync và strict sid. Browser E2E/clock-skew thật chưa chạy. Regression sau thay đổi được duyệt: multi-tab lost response/restart, older response after successor rotation, unrelated-family isolation và expiry/revocation. Không âm thầm tăng budget hoặc gia hạn family để tránh logout.

## Cổng bằng chứng còn thiếu, không tự nhận đã đạt

- **CI đúng candidate:** HEAD cũ `84cef89...` có job [39352834561](https://github.com/phanngocquyet7405/TotMartAPI/actions/runs/39352834561) success; dirty candidate không có commit/run riêng. B01/B02/B03/B04/B05/B06 báo CI pending là lịch sử; query PR-only có thể bỏ sót push run. Kết quả mới dùng collections API với head_sha. Đề xuất owner: repository maintainer/CI. Cần review/commit và chạy CI sau khi có quyền; phiên không commit/push/trigger deployment. Local Windows boot không chứng nhận native Linux signal/job mới.
- **Recovery/HA/backup:** fixture một node; failCommand UnknownTransactionCommitResult không phải ACK mất sau commit đã chứng minh; lease expiry được điều khiển, chưa natural/clock-skew. Chưa multi-node failover/partition, protected/offsite/retention/PITR restore. Đề xuất owner: platform/database; cần topology, recovery objectives, bảo vệ/retention và môi trường drill được duyệt. Archive fixture local không phải backup production.
- **Hiệu năng/đích triển khai:**40-request/concurrency2 và manager dataset1200 products là thăm dò local, không SLO/production scale. Chưa browser/TLS/proxy thật, provider bank/email/upload, courier evidence hoặc staging được duyệt. Đề xuất owner: product/platform/QA/finance theo phạm vi; cần workload/SLO/accounts/target rõ trước probe. Không gọi provider thật hoặc dùng shared data để lấp khoảng trống.

Muốn chuyển sang GO phải có bằng chứng mới cho các cổng áp dụng, xử lý mọi P0/P1 nếu phát sinh, review lại rubric và owner quyết định rõ phạm vi còn lại. Không tự ký risk acceptance hoặc đổi ngưỡng85 vì deadline. B08 kết thúc với bàn giao giới hạn chính xác; không bắt đầu FE/staging.

## B-A1-AV01 — P2 availability transaction/commit, owner chấp nhận có điều kiện

**Quyết định:** owner **Q**, ngày **22/10/2026**, hạ **P1→P2** và chấp nhận phần rủi ro availability dưới đây tới điều kiện hết hạn. Issue **còn mở**; chưa sửa transaction/commit và không đổi kết quả test, source, contract hoặc baseline để đổi mức. Trạng thái P1/chưa có acceptance trong các báo cáo trước quyết định này là lịch sử.

**Phạm vi chấp nhận:** khi Mongo im lặng, TCP không đóng, sau khi request mua hàng đã vào transaction hoặc commit, request có thể chờ lâu hơn budget read5s. Driver6.20.0 có cửa sổ retry mặc định khoảng120s, **không phải hard deadline hay upper bound120s của một await I/O đang treo**. `socketTimeoutMS`/`waitQueueTimeoutMS` vẫn0, chưa có MongoClient/session/transaction CSOT hoặc maxCommitTimeMS cho các call này. Read ngoài transaction thuộc A1 và auth/ownership đã có budget từng read5000ms, **không nằm trong ngoại lệ này**. Không dùng acceptance để bỏ budget đã có hoặc bỏ transaction/fencing/unique index/tombstone.

**Bằng chứng dữ liệu trong phạm vi đã chạy:** [A2-0](B-a2-0-verification.md) có server-injected UnknownTransactionCommitResult và mất ACK Mongo thật: observer độc lập thấy commit khi reply còn bị giữ; replay cùng key/body qua hai backend giữ một Checkout/Order/created Attempt, stock99. Ca code91 đã commit, HTTP503 rồi replay201/cùng result, vẫn một nghĩa vụ. Evidence gốc tại `artifacts/round-b/a2-0/6d74d41c-abf9-4ca8-b4d0-c9431a825748/`: `commits-925443db-0dc2-4926-919f-c5e55c8e17ff/` và `commits-bc2b4b3c-f628-4517-8ffa-9accf0828169/`. Không suy bằng chứng COD products một node thành bảo đảm mọi nhánh hoặc mọi fault; không đổi runner1 của ca91 thành pass.

**Hậu quả còn lại và recovery:** request có thể chờ lâu hoặc trả5xx/503/timeout trong khi kết quả commit chưa rõ. Giữ đúng authenticated user/kind/key và body đã lưu; resolve/replay theo [attempt contract](checkout-attempt-contract.md), không tự đổi key từ lỗi mạng/unknown. Chỉ restart recovery sau invalidated + canRestart:true đúng reference. Created phải khôi phục kết quả cũ; không tự tạo nghĩa vụ mới.

**Giảm nhẹ và trạng thái xác minh:**

- Contract “kết quả chưa rõ” và same-key/body recovery: đã có, giữ nguyên.
- Deadline ở edge: **chưa xác minh/chưa có cấu hình đích được ghi nhận trong repo**; chưa chốt giá trị trong quyết định này. Không lấy deadline client fixture30/45s làm deadline edge. Dù edge ngắt response, không suy ra transaction đã dừng/rollback.
- Cảnh báo readiness/p99: **chưa xác minh đã triển khai ở đích**. Có readiness probe; health-summary/alert adapter local không chứng minh có cảnh báo readiness hoặc p99 được giao tới người trực. Ngưỡng, sink và on-call cần xác minh riêng; không ghi là đã có.
- [Runbook drain khi Mongo chập chờn](B07-operations-runbook.md#mongo-silent-transaction-drain-b-a1-av01): đã bổ sung thủ tục, chưa thực hiện trên đích triển khai. Không phát sinh thao tác hạ tầng trong lượt ghi nhận acceptance.

**Điều kiện hết hạn:** phải **đóng issue bằng A2 hoặc quyết định khác có bằng chứng trước khi mở staging cho người dùng thật hoặc mở bán**. Xem lại sau **DR03/DR05 và phase tải**; các mốc này không được đánh dấu đã chạy trong quyết định này. Không tự gia hạn acceptance, đóng toàn Đợt B, sinh seal, cho phép Đợt C hoặc triển khai từ việc hạ severity.

**Backlog P2 chưa có budget:** prepare/resolve/terminate attempt; checkout create và subscription create (commerce transaction/commit); checkout cancel/confirm-COD/resolve-inventory; subscription cancel/fulfillment; payment command; expiry. Đối chiếu `unbudgetedTransactionCalls` của verifier A1 và [inventory A1](B-a1-verification.md); không suy toàn bộ đã fault-test. Field lịch sử `openP1Availability` của verifier phản ánh inventory khi chưa có quyết định owner, không phải severity hiện hành; giữ nguyên raw evidence. A2-1/A2-2 chưa được thực hiện theo acceptance này.

### Văn bản do owner cung cấp — nguyên văn

Đoạn dưới được chép nguyên văn từ phản hồi của owner trong lượt đóng Đợt B; assistant không ký thay và không điền lại các placeholder. Các placeholder về edge/readiness/p99 chưa phải bằng chứng cấu hình hay triển khai. Ghi chú kỹ thuật về retry window không phải hard deadline ở hồ sơ phân tích phía trên vẫn áp dụng; không chỉnh câu chữ của owner bên dưới.

<!-- owner-decision-start -->
```text
B-A1-AV01 — hạ P1 xuống P2 theo quyết định của owner.
Owner chấp nhận: <Q> — ngày <22/10/2026>.
Phạm vi: khi Mongo im lặng (TCP không đóng) sau khi request mua hàng đã vào transaction hoặc commit, request có thể chờ lâu hơn ngân sách đọc 5s (tới cửa sổ retry driver ~120s). Không áp dụng cho read ngoài transaction (A1, auth đã có budget 5s).
Bằng chứng không mất/trùng dữ liệu: A2-0 (UnknownTransactionCommitResult server-injected và mất ACK thật: replay cùng key/body ra đúng một nghĩa vụ), ca code 91 (đã commit, 503, replay 201, một nghĩa vụ).
Hậu quả còn lại: chờ lâu hoặc 5xx/503/timeout với kết quả chưa rõ; recovery bằng cùng key/body theo contract.
Giảm nhẹ: contract "kết quả chưa rõ"; deadline ở edge: <giá trị, hoặc "chưa cấu hình">; cảnh báo readiness/p99: <đã/chưa>; runbook drain khi Mongo chập chờn.
Điều kiện hết hạn: phải đóng (A2 hoặc quyết định khác có bằng chứng) trước khi mở staging cho người dùng thật hoặc mở bán; xem lại sau DR03/DR05 và phase tải.
Danh sách call chưa có budget (backlog P2): prepare/resolve/terminate attempt, checkout cancel/confirm-COD/resolve-inventory, subscription cancel/fulfillment, payment command, expiry (theo unbudgetedTransactionCalls của verifier).
```
<!-- owner-decision-end -->


### Snapshot backlog P2 khi đóng Đợt B

Owner dưới đây là đề xuất, chưa phải giao việc hoặc owner đã nhận. Inventory cùng predicate với verifier A1; acceptance Q giữ issue mở, không thay read budgets hoặc chứng minh mọi nhánh đã fault-test.

<!-- unbudgeted-close-start -->
- `src/services/checkoutAttemptService.js:47` — `prepare`, `transaction`; P2 còn mở; owner đề xuất: BE commerce/attempt và database maintainer (đề xuất).
- `src/services/checkoutAttemptService.js:91` — `resolve`, `transaction`; P2 còn mở; owner đề xuất: BE commerce/attempt và database maintainer (đề xuất).
- `src/controllers/checkOutController.js:55` — `checkOut`, `withTransaction`; P2 còn mở; owner đề xuất: BE checkout/inventory và database maintainer (đề xuất).
- `src/controllers/checkOutController.js:260` — `cancelOrder`, `withTransaction`; P2 còn mở; owner đề xuất: BE checkout/inventory và database maintainer (đề xuất).
- `src/controllers/checkOutController.js:335` — `resolveInventoryHold`, `withTransaction`; P2 còn mở; owner đề xuất: BE checkout/inventory và database maintainer (đề xuất).
- `src/controllers/checkOutController.js:437` — `changeCod`, `withTransaction`; P2 còn mở; owner đề xuất: BE checkout/inventory và database maintainer (đề xuất).
- `src/controllers/userSubscriptionController.js:45` — `subscribeToTemplate`, `withTransaction`; P2 còn mở; owner đề xuất: BE subscription và database maintainer (đề xuất).
- `src/controllers/userSubscriptionController.js:212` — `cancelImmediately`, `withTransaction`; P2 còn mở; owner đề xuất: BE subscription và database maintainer (đề xuất).
- `src/services/paymentReconciliationService.js:27` — `command`, `transaction`; P2 còn mở; owner đề xuất: BE payment/reconciliation, finance reviewer và database maintainer (đề xuất).
- `src/services/subscriptionService.js:80` — `transitionFulfillment`, `withTransaction`; P2 còn mở; owner đề xuất: BE subscription/fulfillment và database maintainer (đề xuất).
- `src/jobs/orderExpiryScheduler.js:13` — `expireCheckout`, `withTransaction`; P2 còn mở; owner đề xuất: BE workers/inventory và database maintainer (đề xuất).
<!-- unbudgeted-close-end -->
