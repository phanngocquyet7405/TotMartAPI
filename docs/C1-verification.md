# C1 — Phase 7 và 8, fixture local

Ngày 22/10/2026. Cwd đúng TotMartAPI; HEAD mới `fac0dd22887101f545dba187b51e997f078be234` (`check-point 5:20`), working tree sạch trước khi tạo harness C1. Tag checkpoint mới nhất vẫn `round-b-checkpoint-2` ở `56788dffccc4f0164d89160173705864e0023b24`, không phải tag tại HEAD mới. Không commit/push/merge/deploy hoặc sửa FE. **Không chạy Phase 9, không sinh seal, chưa kết luận bàn giao FE.**

B-A1-AV01 là **P2 còn mở, được owner chấp nhận có điều kiện** theo nguyên văn trong BE-open-issues; acceptance không bị sửa hoặc ký lại. Đây không phải triển khai A2 hay đóng rủi ro transaction/commit. Các P2 khác không tự được owner chấp nhận.

Evidence riêng: [run C1](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/entry.json). Node24.14.1, Docker29.9.1; kiểm C: còn khoảng97,9GiB trước dataset/volume. Docker trong sandbox permission denied (exit1), ngoài sandbox hoạt động (exit0): lỗi môi trường/quyền, không phải test ứng dụng. Bốn container và image gốc được ghi inventory trước/sau, không thao tác mutation lên chúng. Mongo dùng volume mới có UUID label; Redis có lease UUID riêng, liên kết evidence C1. Không dùng shared target, provider thật hoặc `.env`.

## Matrix kết quả cuối và exit code

- **7a PASS — 5 pass/0 fail/0 skip**, runner0: [migration-793acf42](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/migration-793acf42-9384-4d83-a886-aac560553953.json). Clone source fixture sang namespace mới, đối chiếu documents/indexes trước test và source không đổi sau test. Dry-run, absent/null/false/true/value legacy, validation/legacy refusal, crash child sau write thật còn trong transaction, rerun, rollback CAS, writer sau apply và writer chen ngay trong dry-run đều được kiểm. Các collection tài chính/session/tombstone sentinel giữ fingerprint; đây là kiểm bảo toàn BSON trên fixture tối thiểu, không phải nghiệm thu ledger sản xuất. Invariant tài chính bằng luồng ứng dụng thật được kiểm riêng ở8a.
- **Regression PASS — 22 pass/0 fail/0 skip**, runner0: [regression-b5d4e7a3](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/regression-b5d4e7a3-931f-4b59-b24b-c7a6b0c34e7f.json). Suite attemptRecovery hiện có dùng MongoMemoryReplSet thật; không lấy limiter local của suite này làm bằng chứng Redis. Lượt cuối ghi run marker/processId và port64974 trả ECONNREFUSED sau helper teardown.
- **7b PASS trong phạm vi đo local**, runner0: [identity-5462918c](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/identity-5462918c-bb87-4aac-8a6f-ab950ac8edfe.json), [số đo và explain](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/identity.json). 200.000 user giả, collision casing/khoảng trắng ở cuối tập, display trùng và field legacy; không đổi login policy/source/index policy.
- **8a PASS**, runner0: [ops-00372973](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/ops-00372973-d2cc-41f1-a8c1-142ee1effa64.json), [backup evidence](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/backup.json). Dump thật, retained host file được copy lại rồi restore vào namespace mới/trống, không `--drop`; 24 collection, count/document fingerprint/index options, quan hệ Checkout–Order–User/Subscription–BoxVersion, ledger, session, product/subscription replay và invalidated tombstone đều được kiểm.
- **8b PASS local**, cùng runner0: [alerts](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/alerts.json). Summary HTTP authenticated thật → dispatcher thật → sink loopback; firing/recovery, failed delivery, lost ACK, dedup, pending được lưu trước delivery và restart từ file. Nguồn summary bị đóng listener thật, quan sát ECONNRESET. Watchdog ở process khác đọc heartbeat bền vững, tự phát firing/recovery rồi thoát0; không chỉ gọi send thủ công. Đây là fixture watchdog, chưa có production wiring.
- **8c DOCS DONE**: [runbook một trang và truy vấn read-only](C1-mongo-silent-runbook.md). Truy vấn được đối chiếu field/model, **chưa chạy trên deployment thật**; không có sửa DB tay.
- **Quality PASS**, từng exit0: `node scripts/quality.js`, `node scripts/quality.js format`, `node scripts/validate-api.js`; [quality.json](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/quality.json). Lint còn18 lỗi debt cũ/không violation mới; API11 operations/8 examples. Không sửa baseline/coverage policy.
- **NOT-RUN:** Phase9, B01 HTTP/full trong C1, migration shared, staging/provider/browser/HA/PITR/offsite và production alert/on-call/SLO. Không dùng kết quả B cũ thay cho các mục này.

Mỗi lệnh `node tests/helpers/roundC1/run.js <mode>` có report UUID và exit riêng; `*-latest.json` chỉ chọn kết quả hiện hành, không đổi các report trước. Không cộng các lượt lặp thành test độc lập hoặc điểm chất lượng.

## Thay đổi migration v2

`scripts/migrate-commerce-integrity.js` là patch hành vi **tool vận hành**, không có sửa `src/`. Manifest version2 dùng `{exists:false}` hoặc `{exists:true,value:...}`; validate collection/id/field/value/presence/overlap/conflict/database trước transaction. Legacy thiếu version/preimage bị từ chối cả apply và rollback; không suy preimage từ dữ liệu đã apply.

Apply/rollback vẫn một transaction, exact-ID/field CAS và postcheck. Null phải tồn tại; absent dùng `$exists:false`; rollback chỉ `$unset` đúng field/ID có preimage absent, không bulk unset. Stale apply bị từ chối, fresh dry-run không còn changes. Owner chỉ được gán từ trạng thái unassigned; nếu writer gán owner ngay trong dry-run, plan bị từ chối. Không chuyển nghĩa vụ/merge account hoặc sửa financial/session/tombstone collections. CAS kiểm physical value/presence, không chứng minh lịch sử ABA khi writer thay đổi rồi trả lại đúng giá trị; quiesce writers vẫn bắt buộc cho rollout.

Regression cũ chỉ đổi kỳ vọng rollback null thành physical absence, giữ các assertion CAS/atomicity khác. Full suite B07 không chạy vì chứa phần load ngoài phạm vi C1. Evidence lịch sử B07 về missing→null giữ nguyên; contract hiện hành được cập nhật version2.

## Identity 200.000 user

Host app.js thật, NODE_ENV=test, concurrency1, Mongo thật; limiter local nguyên vẹn, không claim production strict hoặc Redis cho benchmark. 20 mẫu exact hit,20 indexed miss,10 canonical collision gần cuối tập và10 login HTTP email không tồn tại. Domain giả dùng example.com để đi qua Joi; không gửi email. Không warmup riêng; raw sample và resource windows được giữ.

- Exact hit p50/p95 **2,43/3,02ms**; indexed miss **1,93/2,69ms**. Explain dùng email_1 IXSCAN, tương ứng1/0 document và1/0 key examined.
- Canonical collision p50/p95 **1738,11/1865,67ms**, trả ambiguous-refused. Fallback explain COLLSCAN,200.000 documents/0 keys.
- Login email không tồn tại, thực đi qua canonical fallback, p50/p95 **1820,20/2093,24ms**; **10/10 HTTP401,0/10 HTTP503,0/10 timeout** dưới options timeoutMS5000 hiện tại. **Thời gian tới503 không quan sát được**, không gán thành5s hoặc cam kết upper bound cho mọi dữ liệu.
- Mongo CPU user/system theo resource window: hit10/10ms; indexed miss10/0ms; collision1940/240ms; login miss1780/230ms. Mongo resident486–487MiB; counters Linux có resolution10ms. Window bao gồm queries/bookkeeping và các lần lấy counter, không phải profile CPU thuần của route.
- Backend CPU user/system cộng từ mẫu: collision13218/187ms, login miss14984/140ms; RSS lớn nhất tương ứng khoảng224,1/236,0MiB. Hai nhánh exact nhanh trả CPU counter0 trên Windows; không suy là không tốn CPU. Raw per-sample CPU/RSS và Docker CPU/RAM samples có trong identity.json.

Index inventory của users chỉ `_id_` và unique `email_1`; không có canonical/display unique index trong fixture này. Đã phân biệt rõ indexed lookup và scan nên không tăng tới1.000.000; dataset lớn hơn/đích thật/concurrency khác chưa đo. [Đề xuất canonicalEmail + unique index và kế hoạch migration/rollback](C1-identity-migration-proposal.md) là đề xuất để owner duyệt, chưa áp field/index hoặc đổi login.

## Archive/restore và alert

Archive giữ trên host: [c1-fixture.archive.gz](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/c1-fixture.archive.gz), **7118 byte**, SHA-256 raw bytes **`14c8cb652584cae91e8c82acb27f6323a8859427067b42f6aa2633b5ff5b0267`**. Dump container, host trước restore, retained-file copy trong container trước/sau restore và host sau restore đều khớp hash này. `mongodump/mongorestore100.19.1`; dump477ms, restore command/transfer2074ms, **RTO local2400ms** từ trước transfer restore tới hết integrity checks và HTTP recovery.

Quiesce: đóng listener writer, không khởi động worker scheduler; source inventory không đổi qua dump. Sentinel chỉ dành cho alert được dọn đúng ID/run marker trước dump, không xóa business notification hoặc tài chính. Fixture gồm online product/coupon, subscription, receipts từng phần/surplus, pending refund, active session và tombstone qua luồng BE thật. Marker sequence1 được ACK trước dump và có sau restore: **0 acknowledged marker write mất**, chỉ trong cửa sổ fixture quiesced; không phải RPO thời gian cho production.

Watchdog750ms chỉ là ngưỡng fixture, không phải SLO. Adapter đã có durable pending qua save callback; production cần state-store/atomicity/retention và scheduler được review. Summary hiện chưa có purchase latency/p99, số request đang chạy, sustained readiness not_ready hoặc tuổi processing attempt quá ngưỡng; growth/capacity không thay thế các tín hiệu này. Chỉ liệt kê đề xuất, không thêm source telemetry trong C1. Platform/BE cần owner cho channel/TLS/authenticated reader, on-call, threshold/SLO, lịch tick/dead-man độc lập; finance/security cần tham gia theo queue.

Archive không mã hóa/offsite/PITR; không chứng minh multi-node consistency hoặc concurrent-writer recovery. Các hạn chế P2-02/P2-04 và B-A1-AV01 vẫn mở; presence bug P2-03 đã sửa trên clone, shared rollout vẫn cần review riêng.

## Lượt lỗi, phân loại và bảo toàn evidence

- `migration-red-9077d06f`: exit1,0 pass/1 fail/3 skip theo filter; **assertion ứng dụng/tool migration** thiếu version2. `migration-owner-red-f18bb608`: cùng count/exit, **assertion validation** còn nhận preimage owner đã gán; chỉ gọi validate, không apply manifest đó. Giữ cả hai red reports.
- `identity-4bd95a77`: exit1, **harness** dùng email `.test` không qua Joi; không lấy các sample trước lỗi làm benchmark hoàn chỉnh. Đổi fixture domain hợp lệ, không nới validator/assertion.
- `migration-4ebaa07e`: exit1,4 pass/1 fail/0 skip; **harness** specimen product thứ hai thiếu productId/slug, đụng unique null. Thêm ID/slug riêng, không drop/sync index.
- `ops-dccb9677` exit0 ban đầu chưa chứng minh source transport thật và chưa có process watchdog độc lập; **khoảng trống harness**, không dùng làm gate8b cuối. Hai lượt `ops-2e16b5be`/`ops-6d8d6823` exit1: **harness** chưa xét ECONNRESET của Windows. Lượt sau giữ assertion phải có lỗi transport thật và thêm watchdog process độc lập; mọi invariant restore/business giữ nguyên.
- Lint đầu exit1 có hai lỗi mới ở harness (unused import/control-regex), format đầu exit1; đã sửa code/format, không đổi baseline. Lượt quality giữa exit1 chỉ còn format quality helper. Subprocess quality trong sandbox không chạy được: **môi trường/quyền**, ngoài sandbox mới có kết quả0. Các dò đường dẫn không tồn tại/patch context không khớp là lỗi công cụ/harness, không tính test ứng dụng hoặc môi trường DB pass.
- Resource metadata lần red đầu dùng tên chung, bị lượt green kế tiếp thay thế trước khi thêm tên per-attempt. ID red đã được giữ trong terminal output; cleanup audit ghi rõ nguồn quan sát và kiểm absent độc lập, không tạo lại raw artifact giả. Từ đó resource files có attempt UUID; snapshot từng attempt giữ JSON/archive tương ứng.

Không ghi nhận mất/trùng/chuyển nghĩa vụ ngoài ý muốn hoặc rollback ghi đè writer trong các fixture đã chạy. Không suy từ phạm vi này thành bảo đảm mọi lịch sử/concurrency hoặc dữ liệu thật.

## Cleanup và file bàn giao

[Cleanup audit](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/cleanup.json) liệt kê **21 exact container IDs absent,9 volume names absent**, bốn container/name và image tag/ID đầu vào không đổi. Mongo/Redis cleanup chỉ qua ownership lease; không prune/FLUSH/kill theo tên. Watchdog child thoát0; native regression cuối port64974 ECONNREFUSED. Native regression đầu đã await helper teardown nhưng không có inventory OS độc lập; không claim toàn máy không còn Node/mongod.

Full files before/after có tại [export manifest](../artifacts/round-c1/93800645-c01e-40df-acc6-c868128f8a4c/full-file-export.json): **hành vi** = migrate-commerce-integrity.js; **tooling/test/docs** = regression expectation/ownership evidence, commerceMigrationC1, roundC1 helpers và tài liệu C1/contract/issues; **format** = cặp full files tại format-passes với AST equality, không format lan repo. Bản before của file tracked lấy từ HEAD blob, không giả là byte snapshot CRLF của working tree. File mới không có HEAD preimage.

Final audit xác nhận src, policy/lockfile và HEAD không đổi, nguyên văn owner giữ nguyên, hash seal B lịch sử `8bb7e9f19446eaaf1987a959069f5ff02a83752dace10608887a507ea1c34719` không đổi. Seal cũ là evidence snapshot B, không được tái gắn cho C1 đã sửa tooling. Đây là kiểm tra evidence/cleanup, **không sinh seal C1**. Dừng sau C1, chờ “tiếp”.
