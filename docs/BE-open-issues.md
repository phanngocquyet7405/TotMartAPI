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

## BE-SEC bổ sung — Ajv đã vá, Phase 9 kiểm chứng lại trên snapshot cuối

Theo yêu cầu mới của owner tiếp tục hoàn thiện các phần còn lại, lượt này mở rộng từ runtime sang **Ajv dev** và kiểm chứng local Phase9. Giữ HEAD `c7f4bb1dfcc8714ca9b1a7ed679975029b0c5706`, mọi sửa BE-SEC có sẵn, không sửa src/FE/contract/route/claims, không dùng npm audit fix --force hoặc commit/push/deploy. Hồ sơ BE-SEC ở các mục tiếp theo là snapshot lịch sử, không được coi là seal cho dependency cuối.

- **Ajv8.17.1→8.18.0**, ghim chính xác trong devDependencies: bản vá tối thiểu của [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6). Chỉ entry root và node_modules/ajv đổi so với lockfile khi bắt đầu lượt bổ sung; không có gói khác đổi. [Diff đầy đủ](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/lock-changes.json).
- Source chỉ dùng Ajv trong scripts/validate-api.js, tests/apiContract.test.js và tests/helpers/apiContract.js; các cấu hình đã rà không bật `$data`. Regression dùng engine RegExp giả để kiểm dispatch, không chạy regex tốn CPU: trước nâng **3 pass/1 fail**, sau nâng **4 pass/0 fail/0 skip**, hai suite. Bản vá tôn trọng engine được cấu hình cho dynamic pattern; không suy thành mọi regex do người dùng cung cấp đều an toàn khi dùng native engine. [Trước](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/ajv-before.json), [sau](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/ajv-after.json).
- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` và `npm ci`: **exit0/0**. `npm audit --json` bao gồm dev: **exit0,0 vulnerability**; `npm audit --omit=dev --audit-level=high`: **exit0,0 vulnerability**. Cảnh báo Ajv moderate của snapshot trước đã được xử lý, không còn là phần chưa vá. [Audit toàn bộ](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/audit-all.stdout.txt).
- Đầu vào Phase9 lần đầu **exit1 do Docker Desktop/Linux daemon không chạy**, chưa tạo container hoặc đổi pointer run. Khởi động Docker Desktop exit0, entry retry exit0 xác nhận **bốn container gốc**. Lỗi môi trường và lần fail regression được giữ riêng; không gọi gate ứng dụng đã pass từ việc setup trở lại thành công.

Phase9 dùng run mới `artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/`, không tái sử dụng image/seal của snapshot trước nâng dependency. Kết quả từng gate, cleanup, archive/restore chain, manifest và preflight/seal/check được cập nhật tại [C2 verification](C2-verification.md). Nghiệm thu local không thay CI remote đúng commit, browser E2E, staging/production hoặc đóng B-A1-AV01/P2 khác. Không truy cập dữ liệu dùng chung, không prune hoặc tác động container/image gốc; tài nguyên test dùng riêng phải do harness xác minh ownership trước cleanup.

**Sửa harness clock sau red fault run:** lượt fault đầu exit1, cleanup0,0 pass/1 fail/3 not-run ở Redis stop/start; diagnostic nguyên script cũng exit1/cleanup0. Watcher thực nhận remote end/close, nhưng host Windows ghi faultAt1792863544333 còn fixture ghi observedAt1792863542778 sau khi đọc control đó: hai đồng hồ không cùng epoch, không thể so trực tiếp. [Quan sát giữ trước cleanup](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/diagnostics/303c9b39-b4bf-4b05-8ea7-ee95ccb183c7/fault-diagnostics.json). Không đổi hai red run thành pass hoặc suy ra lỗi ứng dụng từ gate quan sát này.

Sửa riêng tests/helpers/roundB/close-faults.js và tests/helpers/roundC2/sse-deadline.js: control được tạo bằng đồng hồ fixture như timestamp watcher; phía host giữ budget65s bằng performance.now monotonic. Giữ nguyên remoteClosure, điều kiện remote end, deadline65s, không chấp nhận local destroy/abort và recovery assertions. Lưu watcher result vào report để không mất lỗi sau cleanup. tests/sseHarnessDeadline.test.js thêm ca host lệch ±120s, vẫn từ chối end quá65s; nhóm harness/verifier **88/88,0 fail/skip**, exit0. Không sửa src, policy, baseline hoặc tăng timeout. [Regression](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/clock-unit.json). Vì shared fault harness thay đổi, quality và toàn bộ direct gates/image/snapshot/HTTP/full được chạy lại; npm ci được giữ từ cùng lockfile đã cài thành công, không tái dùng kết quả direct gate trước sửa clock.

**Sửa chờ lease của worker trên cùng fixture clock:** lượt worker đầu4 pass/1 fail/0 skip, cleanup0, lỗi security-check. Hai lệnh drain hoàn tất ở fixture time1792865053986/1792865054656, đều trước leaseUntil1792865054964, trong khi host đã coi chờ lease xong. [Proof từ report gốc](../artifacts/be-sec-followup/7a885c7a-111f-475a-9e53-d3e3ee6d539f/worker-clock-proof.json). Chỉ sửa tests/helpers/roundB/a1-workers.js để chờ trong fixture theo đúng lease/backoff do fixture tạo, ghi thời điểm đã chờ vào report; không sửa lease30s security/60s notification hoặc business scheduler. Subprocess chờ có trần90s; trước đó vòng chờ host không có trần riêng. tests/helpers/roundC2/sse-deadline.js thêm helper chờ fixture và tests/sseHarnessDeadline.test.js kiểm30s/60s bằng clock tiêm; nhóm regression/verifier **90/90**, exit0. Các assertion published, redelivery và dedup giữ nguyên. Vì shared harness đổi thêm, toàn bộ direct gate/image/quality/HTTP/full chạy mới trên snapshot cuối; giữ nguyên lần fail và toàn bộ evidence trước sửa.

## BE-SEC lịch sử — 24/10/2026: đã hoàn tất hồ sơ và các gate trong phạm vi được duyệt

Tiếp tục theo lệnh owner “tiếp”; owner xác nhận **cho phép nâng qs bắt buộc**, giữ Ajv dev ngoài phạm vi, và **“Giữ bản vá, không sửa src”** sau khi được thông báo thay đổi ranh giới multipart text field. HEAD vẫn `c7f4bb1dfcc8714ca9b1a7ed679975029b0c5706`. Không thêm tính năng trong source, không đổi route/claims/contract hoặc sửa src/FE. Hồ sơ dừng ban đầu phía dưới là lịch sử, không phải kết quả hiện hành sau vá.

### Toàn bộ thay đổi package-lock trước/sau

- **body-parser2.3.0→2.4.0**: bản vá high tối thiểu trong nhánh2, qua Express5.3.0 không đổi. Manifest mới yêu cầu qs`^6.16.1`, content-type`^2.1.0`, iconv-lite`^0.7.3`; hai gói cuối đã thỏa và giữ nguyên phiên bản.
- **multer2.4.0→2.5.0**: bản vá high tối thiểu, range package.json hiện có vẫn thỏa.
- **ip-address10.7.3→10.7.4**: bản vá moderate tối thiểu, dependency của express-rate-limit.
- **sanitize-html2.17.7→2.18.1**: sửa package.json và root lock entry thành pin chính xác **2.18.1**. Ba advisory đã liệt kê ở hồ sơ bên dưới; audit đề xuất2.18.1, dù advisory bắt đầu vá ở2.18.0.
- **qs6.16.0→6.16.1**: dependency bắt buộc của body-parser2.4.0, owner đã đồng ý. Các consumer Express/superagent dùng chung bản này.
- **deepmerge4.3.1→4.3.1**: chỉ thêm `dev:true`, không đổi version/resolved/integrity. sanitize-html2.18.1 bỏ dependency deepmerge, gói còn được Jest dùng. Đây là metadata đổi trong lockfile, không phải nâng gói thứ sáu.

Không thêm/xóa package, không đổi phiên bản gói khác; Ajv8.17.1 giữ nguyên. Các dependency ranges mới của sanitize-html đều đã thỏa bởi lock cũ. [Diff mọi entry](../artifacts/be-sec/20261024/lock-changes.json), [kiểm phạm vi năm phiên bản và metadata](../artifacts/be-sec/20261024/lock-scope-verification.json), [cây đã cài](../artifacts/be-sec/20261024/installed-tree-after.stdout.txt).

Chỉ sửa pin sanitize-html bằng tay rồi chạy `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` và `npm audit fix --package-lock-only --ignore-scripts --omit=dev --json`, lần lượt **exit0/0**. Không dùng `--force`; audit fix không chạm pin Ajv dev. Không suy số `changed:0` của báo cáo package-lock-only thành lockfile không đổi: danh sách trên lấy từ so sánh mọi entry trước/sau.

### Đầu ra sanitize và thay đổi hành vi đi kèm

Đã chụp bằng **bản cài2.17.7 trước nâng** và **bản cài2.18.1 sau npm ci**, cùng chín payload: SMIL namespace, noscript implied-close, meta refresh javascript/data, anchor javascript/encoded-javascript/data, HTML mô tả product và brand hợp lệ. [Trước](../artifacts/be-sec/20261024/sanitize-before.json), [sau](../artifacts/be-sec/20261024/sanitize-after.json), [so sánh từng output](../artifacts/be-sec/20261024/sanitize-comparison.json).

**Policy safeHtml thực của ứng dụng:9/9 output bằng nhau; nội dung hợp lệ2/2 không có khác biệt byte.** Giữ headings/list/blockquote/emphasis, link http/https/mailto/relative và title; `<br>` vẫn chuẩn hóa thành `<br />` như trước. Mẫu noscript vẫn hiện text/link “Hidden” ở cả hai bản vì policy hiện hành không đưa noscript vào nonTextTags; không tuyên bố đã thay đổi policy đó hoặc mọi nội dung noscript đều bị discard. Các URL executable trong bộ mẫu không tồn tại trong output ứng dụng.

**Cấu hình riêng tái hiện advisory** (không phải cấu hình runtime): bốn output thay đổi. SMIL mất svg:animate có javascript; noscript với nonTextTags cấu hình rõ mất phần Hidden; hai meta refresh mất content có javascript/data nhưng giữ `<meta http-equiv="refresh" />`. Bốn assertion advisory thất bại trên2.17.7 và đạt trên2.18.1.

Upload file ảnh2MB/5MB, số file10, logo2MB và JSON/urlencoded100KB: regression kiểm ranh giới nhận đúng limit/từ chối limit+1, kiểu ảnh và cleanup hiện có đều đạt. **Không tuyên bố mọi hành vi parser/upload đều bất biến:**

- Multer2.5.0 sửa ranh giới **text field** thành inclusive: đúng4096 byte (logo) và đúng1MiB (mặc định product/combo) được parser nhận;2.4.0 từ chối tại đúng giới hạn, limit+1 vẫn lỗi LIMIT_FIELD_VALUE. Đã review source diff và replay nguyên make-middleware2.4.0 chụp trước nâng với supporting dependencies không đổi, so với bản cài2.5.0; đây là probe parser riêng, không khẳng định Joi/controller sẽ chấp nhận mọi field dài đó. [Probe, exit0](../artifacts/be-sec/20261024/field-boundary-comparison.json). Owner chọn giữ bản vá và không sửa src.
- Body-parser2.4.0 thêm nhận Content-Encoding zstd khi Node hỗ trợ;2.3.0 chỉ nhận identity/gzip/deflate/br. Đây là thay đổi thư viện được xác minh từ source và [release notes](https://github.com/expressjs/body-parser/releases/tag/v2.4.0), chưa chạy probe Zstandard riêng. Gzip và giới hạn decoded100KB đã được test; không tự sửa src để chặn encoding mới. Release còn sửa lifecycle decompressor sau body/charset error và tránh mutate read options. [Source thư viện trước/sau và diff](../artifacts/be-sec/20261024/library-review-diff.json).

### Kiểm chứng hiện hành và lịch sử fail

- `npm ci`: **exit0**, cài578 package, đủ devDependencies. Audit mặc định lúc cài còn một moderate thuộc Ajv dev.
- `npm audit --omit=dev --json`: **exit0**, **0 vulnerability** (trước:2 high/2 moderate); `npm audit --omit=dev --audit-level=high`: **exit0**. [Audit runtime](../artifacts/be-sec/20261024/audit-after.stdout.txt), [high gate](../artifacts/be-sec/20261024/audit-high-after.json).
- `npm audit --json` (bao gồm dev): **exit1**, còn **Ajv8.17.1 moderate duy nhất**; không phải runtime audit fail và chưa được vá/accepted trong hồ sơ này. [Output](../artifacts/be-sec/20261024/audit-all-after.stdout.txt). Không theo gợi ý --force của npm ci.
- Regression trước nâng: **41 pass/5 fail/0 skip**, exit1; gồm **4 expected advisory failures** và **1 lỗi transport của test gzip** (superagent serialize Buffer thành JSON). Sửa test dùng identity serializer; parser/upload trước nâng **8/8**, exit0. Lần fail gốc và matcher vẫn giữ. Sau nâng: **84 pass/0 fail/0 skip,8 suite,exit0**; gồm sanitizer/parser mới, pricing, brand logo, manager integration/unit, box definition/snapshot. Mongo thật dùng riêng qua helper, provider ảnh được mock; không coi mock là provider thật. [Trước](../artifacts/be-sec/20261024/regressions-before.json), [parser đã sửa](../artifacts/be-sec/20261024/parsing-before-corrected.json), [sau](../artifacts/be-sec/20261024/regressions-after.json).
- `npm run lint` / `npm run format:check` / `npm run validate:api`: **exit0/0/0**. Lint18 debt/0 violation mới, không đổi baseline; API11 operation/8 example. [Lint](../artifacts/be-sec/20261024/lint-after.stdout.txt), [format](../artifacts/be-sec/20261024/format-after.json), [API](../artifacts/be-sec/20261024/api-after.json).
- `npm run test:b01:http`: **16 pass/0 fail/0 skip**, Jest/runner/cleanup **0/0/0**, run `http-4dt2bK`. [Command](../artifacts/be-sec/20261024/b01-http-after.json), [exit](../artifacts/b01/http-4dt2bK/exit.json).
- `npm run test:b01`: **862 pass/0 fail/0 skip,83 suite**, Jest/runner/cleanup/coverage **0/0/0/0**, run `all-K0F2t2`. Coverage gate **8 module/0 failure**, policy version2 giữ nguyên byte; source hashes và branch instrumentation của các module được bảo vệ vẫn khớp nên không cần cập nhật policy. Toàn source: lines78.98%, branches70.90%, statements76.71%, functions75.44%, không có skipped instrumentation. [Command](../artifacts/be-sec/20261024/b01-full-after.json), [exit](../artifacts/b01/all-K0F2t2/exit.json), [coverage gate](../artifacts/b01/all-K0F2t2/commerce-coverage-gate.json). Đây là lượt chạy mới, không dùng kết quả C2 cũ thay thế.

Lỗi thao tác bổ sung: lần capture sanitizer đầu exit1 do evidence script sai relative path, chưa tạo capture; đã sửa script và chụp thành công trước mọi nâng dependency. Hai tìm kiếm helper chỉ đọc sau đó exit1 vì glob Windows/tên file đoán không tồn tại; không có mutation. [Các lần fail bổ sung](../artifacts/be-sec/20261024/resume-failures.json). Các failure cũ không bị ghi đè. Evidence tại `artifacts/be-sec/20261024/`; command JSON và stdout/stderr tách riêng từng lần, kể cả fail. Execution manifest ghi trước B01; audit sau run xác nhận source/tests/config không thêm/mất/đổi so với manifest và cả hai B01 source snapshots. Coverage policy/baseline giữ nguyên.

Audit cuối chỉ đọc Docker **exit0**: **9 exact container IDs** được nhận diện trong hai run B01 đều absent; **bốn container gốc** giữ nguyên ID/name/image/state, **11 image references** trước test vẫn còn nguyên. Cleanup runner HTTP/full đều0, không có cleanup mutation bổ sung. [Audit snapshot/exit/coverage/resource và ledger từng command](../artifacts/be-sec/20261024/final-verification.json), [command audit cuối](../artifacts/be-sec/20261024/final-audit.json). Không suy kiểm kê này thành nghiệm thu HA/production hoặc mọi tài nguyên ngoài phạm vi evidence B01.

File tracked đổi: package.json, package-lock.json, docs/BE-open-issues.md; thêm tests/dependencySecurity.test.js, tests/dependencyParsing.test.js, tests/helpers/sanitizePayloads.js. Không sửa src/, contract/route/claims, lint/coverage policy hoặc baseline. Không đọc .env/secret. Chưa chạy strict boot/Phase5/fault/worker/seal của Phase9 và không tái sử dụng seal C2 cũ cho dependency mới; các test worker/fault thuộc inventory B01 full vẫn được runner chạy theo suite, không phải direct gates Phase9. Không commit/push/deploy/migration dữ liệu thật/prune. Ajv dev moderate còn mở ngoài phạm vi; runtime audit sạch không phải toàn dependency sạch.

**Khép hồ sơ theo lựa chọn owner “Hoàn tất hồ sơ BE-SEC”.** Cả năm mục của nhiệm vụ đã có bằng chứng: audit/advisory và bản vá tối thiểu; nâng đúng phạm vi và so lockfile; output sanitize trước/sau cùng regression; npm ci/quality/audit high/B01 HTTP/full/coverage; registry ghi kết quả và giới hạn. [Biên bản khép hồ sơ](../artifacts/be-sec/20261024/closeout.json) liên kết hash các file thay đổi và bằng chứng của từng mục; bản sao đầy đủ sáu file để review nằm trong `artifacts/be-sec/20261024/closeout-files/`. Source/config vẫn khớp snapshot đã kiểm thử nên không chạy lại các suite đã đạt. Phase9 là công việc riêng chưa thực hiện; không có gate BE-SEC bắt buộc nào còn chờ chạy trong phạm vi được duyệt.

## BE-SEC lịch sử — 24/10/2026: dừng sau audit dry-run, chưa áp dụng bản vá

Cwd `C:/Users/84862/Desktop/totmart/TotMartAPI`; HEAD `c7f4bb1dfcc8714ca9b1a7ed679975029b0c5706`, working tree sạch khi vào; Node24.14.1/npm11.11.0. Đã đọc AGENTS.md và C2-verification.md. Đây là kiểm tra dependency, không thay đổi trạng thái nghiệm thu C2 hoặc đóng các issue cũ.

### Lỗ hổng và bản vá tối thiểu đã xác minh

- **body-parser 2.3.0 — high**, [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828): trailing bytes sau body nén có thể gây uncaught error và dừng process. Bản vá tối thiểu cùng nhánh **2.4.0**; dependency gián tiếp của Express5.3.0, range `^2.3.0` cho phép bản vá.
- **multer 2.4.0 — high**, [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m): callback fileFilter bất đồng bộ sau teardown có thể gây crash. Bản vá tối thiểu **2.5.0**, nằm trong range trực tiếp `^2.1.1`. Các fileFilter hiện hành trong repo gọi callback đồng bộ; điều này không thay thế yêu cầu nâng dependency hoặc kiểm thử.
- **ip-address 10.7.3 — moderate**, [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5): regex zone IPv6 có thời gian xử lý bậc hai trước kiểm tra độ dài. Bản vá tối thiểu **10.7.4**.
- **sanitize-html 2.17.7 — moderate theo mức tổng hợp của gói**, ba advisory: [noscript/implied-close, moderate](https://github.com/advisories/GHSA-x3q4-9hxx-gx8m), [SMIL namespace prefix, low](https://github.com/advisories/GHSA-374f-7chj-9948), [meta refresh javascript:/data:, moderate](https://github.com/advisories/GHSA-cv27-6wvh-8x7j). Cả ba advisory ghi bản vá **2.18.0**; npm audit đề xuất **2.18.1**, phù hợp yêu cầu owner ghim chính xác 2.18.1 hoặc mới hơn nếu audit yêu cầu. Chưa sửa pin 2.17.7.
- Dry-run không có `--omit=dev` phát hiện thêm **Ajv8.17.1 — moderate, devDependency ghim chính xác**, [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6). Advisory yêu cầu tối thiểu **8.18.0** trong nhánh8; audit đề xuất8.20.0. Lỗi ReDoS yêu cầu bật `$data`; chưa xác minh cấu hình có khai thác được trong repo. Gói này không thuộc bốn gói runtime được nêu trong phạm vi ban đầu, chưa nâng.

### Lệnh thực chạy và điểm dừng

- `npm audit --omit=dev --json`: **exit1**, **4 gói: 2 high/2 moderate/0 critical**, gồm sáu advisory trên bốn gói runtime. [Command](../artifacts/be-sec/20261024/audit-before.json), [output](../artifacts/be-sec/20261024/audit-before.stdout.txt).
- `npm audit fix --dry-run --json`: **exit1**. Đề xuất body-parser2.3.0→2.4.0, multer2.4.0→2.5.0, ip-address10.7.3→10.7.4 và **qs6.16.0→6.16.1**. Không áp dụng thay đổi. Hai pin sanitize-html/Ajv còn trong báo cáo; dry-run chưa giải quyết toàn bộ. Phần audit của dry-run còn liệt kê high cũ, không được coi là audit sau nâng thật. [Command](../artifacts/be-sec/20261024/audit-fix-dry-run.json), [output](../artifacts/be-sec/20261024/audit-fix-dry-run.stdout.txt).
- Dừng theo bổ sung của owner: **“Nếu npm audit fix không dùng --force không đủ cho một gói thì dừng và báo”**. Sanitize-html đã được cho phép sửa pin thủ công, nhưng Ajv dev ghim chính xác là phát hiện thêm, và qs là gói ngoài danh sách bốn gói ban đầu. Chưa xác minh qs có bắt buộc theo dependency manifest mới hay chỉ resolver chọn nâng. Không tự mở rộng phạm vi, không dùng `--force`; kết quả dry-run không chứng minh mọi phương án vá thủ công đều cần force.
- Lần gọi audit đầu trong sandbox **exit1 do spawn EPERM**, chưa có kết quả audit; retry có quyền trả kết quả audit thật exit1 ở trên. Đọc Docker trong sandbox bị permission denied; retry đọc inventory có quyền **exit0**, xác nhận bốn container gốc và image references còn nguyên. Hai lệnh rà soát đầu **exit1** do rg nhận đường dẫn glob không tồn tại trên Windows/thư mục policies vắng; không có mutation. Các lỗi thao tác không được tính là kết quả kiểm thử. [Stop state và lỗi thao tác](../artifacts/be-sec/20261024/stop-state.json).

### Lockfile, hành vi và phần chưa chạy

**Mọi gói thực sự đổi trong package-lock: không có; trước/sau giữ nguyên.** body-parser2.3.0→2.3.0; multer2.4.0→2.4.0; ip-address10.7.3→10.7.3; sanitize-html2.17.7→2.17.7; qs6.16.0→6.16.0; Ajv8.17.1→8.17.1. So sánh mọi entry lockfile cho danh sách thay đổi rỗng; byte SHA256 package.json và package-lock.json trước/sau khớp trong stop-state.json. Chỉ docs/BE-open-issues.md thay đổi tracked, evidence mới ở artifacts/be-sec/20261024/.

Đã rà mọi nơi dùng sanitizer: safeHtml là wrapper duy nhất require sanitize-html; dùng trong product/brand/box/subscription-template controllers, Product/Brand/Box JSON transforms, boxDefinitionService và managerCatalogService. Policy hiện hành chỉ cho HTML mô tả cơ bản, link http/https/mailto, không SVG/SMIL/meta; chưa chạy payload để kết luận an toàn hoặc tương đương. Multer nằm ở uploadMiddleware (product/manager/box routes) và brandLogoUpload (brand routes). Cấu hình source: JSON và urlencoded100KB; ảnh sản phẩm2MB, tối đa10 file; combo5MB, tối đa10 file; logo2MB/1 file/8 field/9 part/field4KB. Chưa nâng nên chưa có bằng chứng khác biệt upload/giới hạn; không sửa src.

**Chưa chạy:** snapshot đầu ra payload SMIL/noscript/meta refresh/javascript:/data:/HTML hợp lệ trên2.17.7, test regression mới hoặc test liên quan, nâng dependency, snapshot sau nâng/so sánh nội dung hợp lệ, npm ci, lint, format:check, validate:api, audit sau nâng và high gate, B01 HTTP, B01 full/coverage gate. Không có test pass/fail/skip để công bố trong lượt này; không đổi coverage policy/baseline. Audit sau nâng **chưa có**, lỗ hổng **vẫn mở**. Strict boot/Phase5/fault/worker/seal không chạy; không đọc .env/secret, không đổi src/contract/route/claims, không commit/push/deploy/prune hoặc thao tác mutation Docker. Chờ owner chỉ dẫn tiếp về điểm dừng trên.
