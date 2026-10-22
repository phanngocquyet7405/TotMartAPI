# Đợt B — đóng với B-A1-AV01 P2 được owner chấp nhận

Lượt đóng theo yêu cầu owner: xem [báo cáo đóng Đợt B](B-close-verification.md) và seal được verifier sinh trong evidence UUID mới. Strict21/21, Phase5 12/12, bốn fault4/4, code91 hợp đồng1/1, B01 HTTP16/16, full724/724; P2 B-A1-AV01 vẫn mở theo văn bản owner nguyên văn trong BE-open-issues. Không làm A2-1/A2-2, không commit hoặc vào Đợt C. Các trạng thái dừng/chưa đạt phía dưới là hồ sơ lịch sử, không sửa số liệu hoặc seal cũ.

Cập nhật theo owner **Q, 22/10/2026**: **B-A1-AV01 là P2 còn mở, được chấp nhận có điều kiện**, thay cho P1 trước quyết định. Xem [phạm vi, giảm nhẹ và điều kiện hết hạn](BE-open-issues.md). [B01 full/ledger/A2-0](B-a2-0-verification.md) giữ nguyên evidence709/709 và hai ca commit; không phải đã sửa budget. Dừng sau A2-0, A2-1/A2-2 chưa chạy; không tự vào Đợt C. Các trạng thái P1/chưa có owner acceptance phía dưới là lịch sử; acceptance hết hạn trước staging người dùng thật hoặc mở bán.

HEAD thực tế/tag round-a-checkpoint: `62bbb6001728523bf04654bf4aa952f30d99e738`, không đổi. Không commit/push/merge/deploy, sửa FE hoặc migration. Tracked tree ban đầu sạch; báo cáo BLOCKED trước đó đã lưu tại `artifacts/round-b/B-verification-before-current.md.txt`.

Docker Engine hiện tại **29.9.1**, Docker Desktop/WSL2, 12 CPU, 8181829632 byte RAM, khác29.1.3 của Đợt A. Server/components/OS/inventory tên-ID nằm trong `entry-current.json`, preflight0. Node host24.14.1/npm11.11.0; image24.22.0. Không dùng port5000 hoặc tên hubt-* cho fixture. Bốn container/image gốc chỉ được đọc inventory. Seal/manifest/candidate/báo cáo A giữ nguyên, không sửa tay hoặc lấy làm kết quả cho patch mới.

## PHASE 5: PASS trước hai patch hành vi

Candidate A còn nên được tái sử dụng: `sha256:042bd61c35ac3e59cb6ddbff799ac6dd44f3d4f14fa2a9abf0e23d90f5faeea7`. Toàn bộ src/scripts image-host khớp, runtimeTreeMatches=true.

`phase5.json`: runner0/cleanup0; pass12/fail0/skip0/not-run0. UUID2944267c-8169-4f77-ae37-de302c77e214, 7 tài nguyên absent bằng exact ID. Thân assertion 5 ca B06 giữ nguyên, chỉ đổi cầu nối HTTP/DB/factories để chạy qua HTTPS, hai server.js cùng image, Mongo replica set/Redis TLS thật.

- B06: partition receipt/allocation/direct-refund; partial/expiry; prorated subscription/surplus; ownership; snapshot catalog/profile drift.
- Bảy ca bổ sung: auth/cookie/CSRF/CORS/current DB role-active-version-sid; same successor/retry/family; history4096; attempt hai kind/tombstone/replay/key mới; SSE family/PubSub/heartbeat; mất HTTP response sau upstream commit; survivor/restarted backend sau SIGKILL Linux.
- Session/history expiry được seed, không gọi là natural expiry. HTTP loss không phải UnknownTransactionCommitResult/mất ACK Mongo thật. Không browser E2E.

Lịch sử đỏ được giữ riêng, không thay assertion/index:

1. `phase5-first-setup-failure.json`: setup1/cleanup0, pass0/fail0/skip0/not-run12. **Harness**: docker cp exit0 nhưng tmpfs đang chạy không có file; client-probe0/cleanup0 xác minh. Sửa chuyển qua stdin rồi so SHA256 từng file.
2. `second-phase5.json`: runner1/cleanup0, pass0/fail1/skip0/not-run11, chưa HTTP. **Harness**: bỏ app-before-factories làm Brand compile trước global slug plugin. bootstrap-probe0/cleanup0 tái hiện11000/key slug/null; app-first cùng source tạo hai Brand có slug. Khôi phục đúng bootstrap gốc.
3. `third-phase5.json`: runner1/cleanup0, thực tế pass4/fail1/skip0/not-run7. **Harness**: GET.send({}) thiếu Content-Length, Node trả400/HPE_INVALID_METHOD trước Express. get-framing-probe0: framing đúng nhận404/requestId. Artifact thô đếm group B06 sai; framing-resolution.json ghi số đúng từ completedCases, không sửa artifact lịch sử. Runner mới flatten completedCases.

## Hai patch hành vi đầu PHASE 6

**Hành vi1: pino-http disclosure.** pino-image-red.json trên app thật trong image A: production/staging đều có err.message/stack ở request errored; runner1/cleanup0, hai group fail ở field đầu (10 field chưa chạy). src/app.js truyền serializer err riêng trong strict modes, dùng whitelist tách từ logger sang src/utils/safeErrorSerializer.js. pino-http chỉ xuất type/code; errorHandler vẫn giữ event/dependency/requestId và thông điệp chẩn đoán cố định. Không tắt log. Guard kiểm log thô, URI/frame/stack/marker/field err/correlation trước khi lọc artifact.

**Hành vi2: availability503.** errorHandler bổ sung tên Mongo availability chính xác đã đối chiếu driver: network timeout, pool cleared/closed, wait queue timeout, topology/server/client closed. node-redis có name=Error nên dùng instanceof bảy class availability cụ thể, không gom Error chung hoặc regex Mongo/Redis rộng. Không đổi timeoutMS, login policy hoặc contract4xx. Test dùng instance driver thật và negative/domain409 assertions.

- availability-red.json: Jest1, pass51/fail30/skip0; 30 ca thực sự nhận500 thay503 trước sửa BE. Lần đầu test có lỗi harness vì giả định name của Redis; sửa kiểm class thực rồi chạy lại vẫn30 fail500/503. Giữ availability-initial-red.json.
- authMongoDeadline chỉ nhận503 thay500/503. Test silent-find/failpoint/barrier/recovery vốn đã503 trước patch: deadline-red.json Jest0/pass1/fail0/skip0, resource cleaned/absent. Không gọi ca vốn xanh này là test đỏ cho mapping mới; bằng chứng đỏ là30 ca driver phía trên.
- availability-green.json: Jest0, 3 suite, pass107/fail0/skip0, gồm errorDisclosure/log guard/response guard; 4xx status/code/message giữ nguyên. log-guard-red.json (9 fail do hàm guard chưa có) là khoảng trống harness, không phải9 lỗi BE.
- Candidate B: build0/probe0/cleanup0, `sha256:dad5994b78303938bfee10b714c8f8b70358c91b83726446d1a4df4e2eea5032`; tag/digest/label/source hash trong candidate.json. Không đổi Dockerfile. bcrypt load/hash/compare thật, Node24/UID1000; history19 entry, 10 layer/20348 tar entry quét không thấy fixture marker/path bị cấm; không truyền fixture credential vào build. Không sửa image có sẵn.
- pino-image-green.json: runner0/cleanup0, 2 mode/12 marker checks pass, fail0/skip0/not-run0. message/stack/cause/provider/name/code; Pino/pino-http/app thật, chỉ capture destination và chèn route lỗi trong client fixture. Guard log thô rỗng, hai log có requestId khớp. Không gọi provider.
- phase3-final.json: strict boot mới trên image B **21/21**, runner0/cleanup0/skip0/not-run0: server.js/PID1, config trước side effect, transaction/index/PRIMARY, CA/TLS/HTTPS/origin, fail-safe hữu hạn, readiness/live, outage, SIGTERM Linux/đóng SSE/connection. Resources absent. Đây không phải seal mới A.
- Lệnh cuối npm run lint / format:check / validate:api: từng exit0; không violation mới, giữ19 debt cũ; các file đổi đều format sạch; OpenAPI11 operations/8 examples. Không đổi baseline/coverage policy. test:b01:http, test:b01 và PHASE5 sau patch **NOT-RUN** vì cổng PHASE6 đỏ; không lấy kết quả A thay regression mới.

## PHASE 6: FAIL, dừng

phase6-faults.json: runner1/cleanup0, pass2/fail1/skip0; phần worker/restart bổ sung chưa chạy. UUID d0937d30-b694-4ae6-96cd-94ad4a3b8542. Mỗi lần một fault, SSE mở trước fault, verify exact ID/label, finally recovery/cleanup. Toàn bộ7 tài nguyên absent trong phase6-faults-resources.json.

Phạm vi bắt buộc FE của fault/worker PHASE6 gồm 4 fault và 5 nhóm worker: pass2/fail1/skip0/not-run6 (backend kill/restart sau patch và 5 nhóm expiry/delivery/reconciliation/notification/security). Con số notRun0 của runner chỉ nói về danh sách3 fault đã chọn trong script, không bao phủ toàn PHASE6. Hai patch và strict boot được báo riêng, không cộng vào số này. Bốn nhóm PROD bên dưới not-run4.

- Redis stop/start và pause/unpause TCP silent: **PASS**. Cả hai backend readiness503/live200/login503/create503 có requestId; SSE đóng. Sau recovery snapshot khớp, không thấy tác dụng muộn; replay cùng key, một checkout/stock đổi một lần. Hash và từng request/status/requestId nằm trong artifact.
- Mongo network disconnect/reconnect: **FAIL, phân loại CHƯA XÁC ĐỊNH**. Mongo ID fd3756a80a22bc7cd446edd9c9d5d1373d3da38c064ccc964438c4b51e0642d7. faultAt1792575323070; reconnect command xong1792575381134. Production health503/requestId311b2816-01b0-49c2-a656-0b319f1c9847, live200/requestId4a3d05b5-a1e6-4bc9-8eb0-328e08ca1a91, login503/requestIda7db141c-8935-4600-a97e-477c0059bbe2. Lời gọi tiếp theo POST /api/checkout/check-out công bố Error không code, không có HTTP observation. Client deadline cấu hình45s, khoảng58s từ fault tới reconnect; phù hợp nghi ngờ timeout nhưng **chưa đủ bằng chứng kết luận timeout hoặc BE**.
- Thiếu: loại lỗi checkout chính xác (timeout/transport/parse), timestamp bắt đầu/kết thúc, body/header redact nếu có, log backend correlated, readiness/snapshot sau reconnect kể cả khi assertion trước đó fail. Runner bỏ qua kiểm recovery khi observed.passed=false; finally đã reconnect nhưng không được gọi là recovery pass. Container đã cleanup, không thể lấy thêm log của lần này. Chưa chứng minh tác dụng muộn hoặc invariant tiền/kho bị phá; không sửa tiền, timeout hay nới assertion.
- Dừng các fault/worker còn lại vì chưa phân loại đủ. Kill/restart có PASS trước patch trong PHASE5, chưa chứng nhận PHASE6 image B. Worker cạnh tranh/lease/fencing/retry/backoff/restart/backlog image B: **NOT-RUN**. Worker daemon thử soạn chưa chạy lưu dạng .txt trong artifacts, không đưa vào suite như kết quả đạt.
- PROD server-injected unknown commit, multi-node HA, mất ACK commit thật, natural lease expiry/old worker resume: **NOT-RUN**. Không suy từ one-node pause, HTTP loss hoặc sửa lease fixture.

Lỗi BE xác nhận: **P2 pino-http disclosure** (đã sửa/image xanh), **P2 mapping availability500 thay503** (đã sửa/test xanh). Điều tra ưu tiên P1 trước FE: checkout thiếu outcome khi Mongo disconnect, hiện chưa xác định BE/harness; không gắn nhãn môi trường. Không có P0/invariant violation đã chứng minh. Chưa đủ điều kiện bàn giao FE.

## File và bàn giao

Hành vi1: src/app.js, src/utils/logger.js, src/utils/safeErrorSerializer.js. Hành vi2: src/middleware/errorHandler.js, mở rộng whitelist cùng helper, tests/errorDisclosure.test.js, tests/authMongoDeadline.integration.test.js. Contract: docs/FE-BE-contract-handoff.md.

Tooling: tests/helpers/roundB/ (topology, transfer/hash, runner/adapter/client/image log/strict/fault/verifier), tests/helpers/roundA/disclosure-guard.js, tests/roundBLogGuard.test.js, báo cáo này. Không có patch chỉ format; formatter chỉ áp dụng file đã sửa. Xuất đầy đủ từng file tại artifacts/round-b/full-files-current/ với hậu tố.txt để Jest không khám phá bản sao test; verifier tạo manifest export và nhóm patch riêng. Không chỉ giao patch rời.

delivery-verification.json chỉ xác minh integrity/cleanup/export, **không phải seal PASS Đợt B**. Không sinh seal mới khi gate chưa xanh; hash lại lịch sử A/inventory gốc. Cần thu evidence Mongo thiếu, phân loại rồi xử lý theo cổng trước worker/fault/regression tiếp. Dừng chờ “tiếp”.

## Bổ sung hiện hành — A1 checkout read, worker và gate B01

Chi tiết của lượt mới tại [B-a1-verification](B-a1-verification.md). Image `sha256:1b99bfd6902d2020ba0d980847f3c80d7b3ca1a2456db97314968428d8c5f991`, HEAD62bbb60 cộng working tree. Bốn read A1 ngoài transaction: test đỏ Mongo thật trước sửa, sau sửa **4/4** safe503/requestId khoảng5s, snapshot không đổi và same-key/body recovery/key mới đúng. Không đổi transaction/commit/retry/fencing.

Năm nhóm worker có evidence container mới đạt trong phạm vi controlled-drain, thêm backend kill/restart smoke. Các lỗi harness đỏ được giữ/giải thích, không tính thành lỗi môi trường hoặc bỏ qua conservation. Selected B03/DB helper24/24, B01 HTTP16/16, Jest/runner/cleanup0. B01 full và coverage **BLOCKED/NOT-RUN** vì hai migration index drops ngoài ngoại lệ cleanup index duy nhất đã duyệt. Không thay bằng auth12/12/mock49/49, không sửa baseline/coverage gate.

P1 availability transaction/commit còn mở và cần A2 riêng với unknown-commit/lost Mongo commit ACK đúng bằng chứng. **Đợt B chưa đạt, chưa đủ điều kiện Đợt C.** Không seal/commit/push/deploy. Các kết quả trước ở trên là lịch sử, không bị ghi đè; xem matrix/exit/cleanup và full-file exports A1 trước review tiếp.
