# BE open issues và quyết định cần owner — 20/10/2026

Cập nhật 22/10/2026: **B-A1-AV01 P1 vẫn mở**. [A2-0](B-a2-0-verification.md) đã chứng minh server-injected unknown commit đã áp dụng và mất ACK Mongo thật; observer trước ACK/replay hai backend giữ đúng một nghĩa vụ. B01 full709/709 và ledger300007 đạt. Chưa đặt budget transaction/commit; A2-1/A2-2 chờ owner duyệt, không vào Đợt C. Kết luận “không thấy P1” lịch sử bên dưới không phải trạng thái hiện hành.

Phạm vi là candidate B08, self-review/source và bằng chứng local. Không có reviewer độc lập thực sự trong phiên này. Không thấy P0/P1 còn mở được xác nhận trong phạm vi đã rà; điều đó không chứng minh không còn lỗi ngoài phạm vi hoặc production. Không owner nào đã ký nhận rủi ro. Các vai trò dưới đây là đề xuất, chưa phải giao việc hoặc phê duyệt.

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

Trigger: commerce-integrity manifest ghi before bằng null cho field vốn absent. Apply rồi rollback ghi `$set:null`; không khôi phục physical field absence. Source `scripts/migrate-commerce-integrity.js`; B07 migration-cas đã assert subscriptionOnly trở thành null, writer edit vẫn được giữ bằng CAS, protected finance/session/tombstones không đổi.

Ảnh hưởng: code/query phụ thuộc `$exists` có thể thấy khác sau rollback trên dataset có field thiếu. Không có shared apply trong phiên. Đề xuất owner: database/backend migration reviewer. Cần quyết định có yêu cầu presence-preserving manifest version mới hay chỉ chấp nhận value semantics cho dataset được duyệt. Phải kiểm preimage/index/consumer trước rollout; không tự thay format lịch sử hoặc bulk unset. Regression nếu làm mới: absent/null/false phân biệt, stale/writer-CAS, transaction interruption và ledger/session/reference fingerprints.

## P2-04 — Alert adapter chưa được wire production

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

## Bổ sung Đợt B/A1 — availability transaction còn mở

**B-A1-AV01 — P1 availability core checkout, chưa đóng trước FE.** A1 chỉ đặt budget cho read ngoài transaction. `checkoutAttemptService.prepare/resolve`, `checkOutController.checkOut` và subscription create vẫn có transaction/commit không truyền budget driver/session hay maxCommitTimeMS; backend socketTimeoutMS/waitQueueTimeoutMS vẫn 0, không có MongoClient CSOT mặc định. Inventory mở rộng tới transaction cancel/confirm/COD và payment/subscription/expiry ở [B-a1-verification](B-a1-verification.md). Các đoạn chưa đổi từ evidence sau-auth cũ: blockConnection 20s trong transaction/commit giữ HTTP khoảng 20s; phép đo không chứng minh upper bound hoặc mất ACK sau commit thật. Retry window driver không phải deadline ngắt await I/O.

Không có money/stock P0/P1 được chứng minh từ các phép đo đó; **P1 ở đây là availability của đường mua hàng và recovery khi kết quả commit chưa rõ**, không phải kết luận double money. Không hạ thành P2 để khép B, không biến thiếu budget thành lỗi môi trường. A1 xanh không giải quyết mục này và không phải SLA toàn checkout. Cần duyệt A2 riêng: thiết kế budget transaction/session và cùng-key recovery, test server-injected UnknownTransactionCommitResult cùng ca mất ACK sau commit thật có bằng chứng độc lập commit; không dùng HTTP loss/pre-commit kill để thay thế. Chưa sửa transaction/commit trong A1, chưa owner chấp nhận rủi ro, chưa đủ điều kiện Đợt C.
