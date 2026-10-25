# BE release candidate — Phase 9 local sau BE-SEC/Ajv: các gate đạt trên snapshot cuối

HEAD `c7f4bb1dfcc8714ca9b1a7ed679975029b0c5706`, run `artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346`, snapshot SHA256 **`c5216c03a4f92c29e7b27048c68011871fab954feabefd1c7710a68abba8ec5b`**. Runtime host khớp candidate image **`sha256:ef6376cbb5f9a44013d19051c76007067c5ab1671dc27e0ba4d5e0835c25e5c3`**. Owner yêu cầu tiếp tục hoàn thiện phần Ajv còn lại và Phase9; không sửa src/FE/contract/route/claims, không commit/push/deploy hoặc chạy Phase10.

**Hiệu lực nghiệm thu local được xác nhận khi seal và check đều exit0 trên snapshot này.** Xem [ledger verifier cuối](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/verification.json), [seal](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/c2-seal.json), [seal command](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/seal-latest.txt) và [check command](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/check-latest.txt). Báo cáo này được hoàn thiện trước seal để nằm trong source manifest cuối; không sửa tay seal hoặc lấy seal cũ thay snapshot mới. CI remote và staging/production chưa được nghiệm thu.

## Kết quả trên snapshot mới

- Ajv ghim **8.18.0**, bản vá tối thiểu của GHSA-2g4f-4pwh-qvx6. So với đầu lượt bổ sung, chỉ Ajv8.17.1→8.18.0 và root pin đổi; các bản vá runtime BE-SEC được giữ. Audit toàn bộ bao gồm dev và audit runtime đều **exit0,0 vulnerability**. Regression Ajv/API **4/4**, giữ lần trước nâng3 pass/1 fail. Các cấu hình Ajv thực đã rà không bật $data; regression kiểm configured-engine dispatch, không tuyên bố native RegExp miễn nhiễm mọi ReDoS.
- Body-parser Zstandard probe trên host Node24.14.1 đạt **3/3,exit0**: nội dung hợp lệ/decoded body đúng102400 byte được nhận200, decoded102401 byte bị413 entity.too.large. Probe dùng HTTP loopback và cùng cấu hình Express JSON100KB, không provider/DB/Redis; thay đổi encoding mới đã được kiểm trực tiếp bên cạnh source review. Không suy thành browser E2E hoặc mọi middleware route được probe riêng.
- npm ci / lint gate / format:check / validate:api / verifier tests: **exit0**. Lint:all **exit1** với **18 debt cũ/0 warning**; không đổi rules/baseline. API11 operation/8 example.
- Build/runtime probe/cleanup: **exit0**; strict boot **21/21**; Phase5 **12/12**; fault **4/4**; code91 **1/1**; worker **5/5**, đều command/cleanup0 theo verifier. Fault/worker dùng tài nguyên có ownership exact ID/name/label; không provider thật. Các giới hạn fixture một node và điều khiển lease/timer vẫn áp dụng.
- B01 HTTP **16/16**; B01 full **868/868**, **0 fail/skip**; Jest/runner/cleanup/coverage0. Commerce coverage **8 module/0 failure**; lines **78.98%**, branches **70.9%**, statements **76.71%**, functions **75.44%**. Giữ nguyên source-bound policy và instrumentation, không hạ mức bảo vệ.
- Verifier preflight **exit0**: snapshot/invocation/discovery/imported fixture linkage, byte archive và restore chain, resource absence/volume/port, owner acceptance và historical protected hashes đều được kiểm. Archive **64764 byte**, SHA256 **`e209c43ddb4e5ab1e8bb2394411dfe9d3c22a506b916f95bc182dfd18cca1209`**, fixture run `all-VeeCXA`; không suy ra PITR/offsite/HA production.
- Giữ hai red fault run trước sửa clock (mỗi lượt0 pass/1 fail/3 not-run, cleanup0) và worker4 pass/1 fail do host đợi lease fixture kết thúc sớm. Diagnostic xác nhận host/fixture wall-clock khác nhau. Chỉ sửa harness fault control/chờ lease dùng fixture clock; remaining fault budget phía host tính monotonic, remoteClosure/65s và lease30s/60s/backoff/published/redelivery/dedup giữ nguyên. Regression skew/lease/harness/verifier **90/90**; quality và toàn bộ direct gates/image/HTTP/full chạy lại sau sửa cuối. Không gọi red run cũ là pass.

## Phạm vi, cleanup và hồ sơ review

Đầu vào Docker daemon vắng làm entry đầu exit1; Docker Desktop start0 và entry retry0. Giữ lỗi setup, expected advisory red tests và mọi failed evidence; không đổi chúng thành pass. Entry bảo vệ bốn container và mọi image reference gốc. Verifier kiểm exact resource absence, volume và port; [kết quả cuối](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/verification.json) ghi số lượng thực. Candidate image mới được giữ để review, không prune/FLUSH/down volume hoặc cleanup tài nguyên lịch sử.

[Audit Ajv trước/sau và lệnh bổ sung](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/dependency-evidence/), [bộ file/patch để review](../artifacts/round-c2/aeaf2aac-7dfb-44c7-a43b-13990c367346/review-bundle.json), [registry hiện hành](BE-open-issues.md). Tool export C2 lịch sử chỉ chấp nhận phạm vi SSE/test/docs; lượt dependency dùng bundle riêng theo exact allowlist, không mở rộng hoặc sửa policy/verifier để hợp thức hóa patch package.

**Kết luận có giới hạn:** các bước local đã yêu cầu được xác nhận bởi seal/check khi cả hai exit0. B-A1-AV01 vẫn P2 mở đúng nguyên văn owner; các P2 khác không tự đóng. CI remote cần commit được owner review (phiên giữ yêu cầu không commit/push), browser E2E và staging/production/HA/PITR/on-call/SLO cần nghiệm thu tương ứng. Không coi kết quả này là quyền deploy hoặc production-ready.

## Lịch sử release candidate trước BE-SEC/Ajv

# BE release candidate — C2 hiện hành 23/10/2026: gate local và preflight đạt

Snapshot mới **`964baa25ee69e7f38e7e0a7c6c5125ce9d8440929ef806acfd615cc5506ae21f`**, HEAD/check-point-C `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`. Sửa tối thiểu guard đường dẫn fixture để bỏ `throw` khỏi `finally`, giữ cleanup và truyền lỗi. Không disable rule, đổi baseline/policy hoặc nới assertion. Không sửa src/FE, commit/push/deploy, A2 hoặc Phase10; giữ thay đổi có sẵn và lịch sử lỗi.

Nhóm nhanh **111/111**, lint/format/API **0/0/0**; lint:all **1**, đúng **18 debt cũ/0 warning**. HTTP mới **16/16**, full mới **829/829, 80 suite/0 skip**, Jest/runner/cleanup/coverage đều **0**. Commerce coverage **8 module/0 failure**, lines **78.98%**, branches **70.9%**. Không dùng kết quả 824/824 cũ thay snapshot này.

Runtime host `src/scripts/package/lock` khớp image C2 `f07e…4497`, probe/cleanup **0/0**. Giữ cả image mới và `02d3…ab55`. Gate container cũ chỉ tái dùng qua verifier với exact manifest/invocation/delta và 22 copy observations của hai fixture legacy; không bỏ manifest hoặc coi mọi tests/ vô hại. HTTP/full chạy mới trên snapshot có đủ 375 file/22 untracked và imported-input hashes.

Audit tài nguyên mới: **11 container + 1 network + 3 volume absent, 11 port đóng**; tài nguyên gốc, hai image và protected historical hashes giữ nguyên. Verifier preflight **exit 0**, kiểm raw archive/restore chain và exact resource absence. Seal chỉ sinh tự động bằng verifier, không sửa tay; kết luận bàn giao FE local có hiệu lực khi seal/check cùng exit 0. Xem [ledger xác nhận cuối](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/verification.json) và [báo cáo C2](C2-verification.md).

[Full files/ba nhóm diff](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/export-current.json) giữ cả thay đổi SSE có sẵn của lượt trước; không có sửa hành vi mới trong lượt này. Failed lint/full runs, snapshot và export cũ được giữ.

**CI remote chờ owner review và tự commit. Production cần nghiệm thu riêng.** B-A1-AV01 vẫn mở P2 theo nguyên văn owner, không thêm risk acceptance hoặc tự ký production. Dừng sau báo cáo, chờ owner review.

## Lịch sử — giữ nguyên release candidate trước lượt sửa lint này


# BE release candidate — C2 hiện hành 23/10/2026: chưa bàn giao FE

**Dừng tại lint mới exit 1**, rule `no-unsafe-finally` trong regression `tests/roundC2Verification.test.js:56`. Nhóm nhanh hiện hành **111/111 pass**, nhưng chưa chạy quality còn lại/snapshot/HTTP/full cho bổ sung verifier. Không seal/check. [Báo cáo C2 hiện hành](C2-verification.md).

Snapshot trước `16c0c27d…184b`: HTTP **16/16**; full **824/824**, 80 suite/0 skip; Jest/runner/cleanup/coverage đều **0**. Commerce coverage **8 module/0 failure**, lines **78.98%**, branches **70.90%**. Không dùng kết quả này thay kiểm chứng 5 file tooling vừa đổi. Gate cũ chỉ tái dùng theo exact bounded linkage, không bỏ manifest hoặc nới policy.

Runtime host src/scripts/package/lock khớp image C2 `f07e…4497`; giữ cả image mới và `02d3…ab55`. Audit dừng: **11 container + 1 network + 3 volume absent, 11 port đóng**; original/protected artifacts giữ nguyên. Raw archive và restore chain đã audit, chưa có final C2 seal. Full files/ba nhóm patch xem [export hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/export-current.json); lịch sử/failed evidence được giữ.

**BE đủ điều kiện bàn giao FE: CHƯA.** Chờ owner duyệt xử lý lint, sau đó cần snapshot và gate cuối/seal/check hợp lệ. CI remote chờ owner review và tự commit; production nghiệm thu riêng. Không sửa src/FE, commit/push/deploy, A2 hoặc Phase10.

## Lịch sử — release candidate trước lượt tooling này


# BE release candidate — C2 dừng ở B01 full

Hiện hành23/10/2026, HEAD/check-point-C `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`, contract candidate `C2-20261022.1`. Image mới chứa sửa SSE **`sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`**; runtime toàn source khớp host, không overlay. Image C2 cũ giữ nguyên riêng để review. [Báo cáo hiện hành](C2-verification.md), [snapshot](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot.json).

PASS: ci/build/runtime/lint/format/API từng0; verifier32/32, strict21/21, Phase5 12/12, fault4/4 (kể cả Mongo/SSE và backend kill/restart), worker5/5, code91 committed503→same-key201/một nghĩa vụ, B01 HTTP16/16. Mọi runner/cleanup các gate này0. Lint:all1 còn18 lỗi debt, không violation mới.

**FAIL B01 full: Jest1/runner1/cleanup0/coverage0.**79 canonical suite/777 test đạt; Jest cũng quét50 artifact-copy suite (6 pass/99 test,44 runtime-error suite). Tổng876 passed tests không phải count canonical. Phân loại harness discovery, không biến full fail thành pass hoặc nhận coverage trộn lịch sử làm nghiệm thu. [Failure evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-full-failure.json). Không sửa config hoặc src để chạy tiếp; đề xuất giới hạn discovery về tests/ cần owner duyệt và snapshot/rerun phù hợp.

Audit tổngC2:163 container+22 network+3 volume absent,13 port đóng; riêng lượt mới:97 container+13 network+3 volume absent. Bốn container/image gốc và seal/backup lịch sử giữ nguyên; image mới/cũ được giữ. [Audit](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-final-cleanup.json), [full files/diff](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches.json).

Full có archive B07 retained host và backup evidence, nhưng final restore-chain verifier/preflight chưa chạy. Không seal/check/Phase10/commit/FE edit. CI remote trên commit review cuối còn chờ owner. Rubric chưa nghiệm thu sau full fail; self-review, không reviewer thứ hai.

FE giữ [handoff](FE-BE-contract-handoff.md): create/prepare/terminate5xx/503/timeout là kết quả chưa rõ, giữ key/body và lookup; committed503 có thể replay201, không mở key mới. Message5xx/requestId, refresh/session/CSRF, email canonical legacy và routes subcribe/check-out giữ nguyên; cần browser E2E. SSE dùng CSOT từng read5s, không phải SLO tổng hay budget transaction. Migration/rollback và canonical proposal C1 chưa áp dữ liệu thật; không merge/chuyển nghĩa vụ.

B-A1-AV01 vẫn P2 theo nguyên văn owner. Các P2 khác không tự accepted; A2 nếu còn P2, edge/alert/on-call/SLO/HA/PITR/offsite và staging/production cần nghiệm thu riêng.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng

Dừng, chờ owner duyệt xử lý harness discovery.
