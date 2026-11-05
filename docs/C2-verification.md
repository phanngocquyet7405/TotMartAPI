# C2 — Phase 9 local sau BE-SEC/Ajv: các gate đạt trên snapshot cuối

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

## Lịch sử trước lượt BE-SEC/Ajv

# C2 — hiện hành 23/10/2026: sửa fixture để local và CI chạy cùng điều kiện

Bản sửa test/harness đã qua regression local; **chưa có CI remote trên commit chứa bản sửa, chưa sinh seal mới**. HEAD giữ `3589182f6df967fab57fe766a7a7ae9df301dd31`; các thay đổi hiện hành chưa commit. Không sửa `src/`, FE, script migration nghiệp vụ, dependency hoặc baseline/policy. Không push/deploy, A2 hay Phase10. Seal C2 trước là bằng chứng lịch sử của snapshot cũ, không chứng nhận working tree vừa sửa.

## Vì sao 801 local khác 827 trên GitHub Actions

CI run `39886751624` chạy B01 runner: 827 pass/2 fail, không skip. `test-output.log` local chạy `npm test`: 801 pass/9 fail/19 skip. Chênh 26 pass gồm 19 test Redis bị skip và 7 ca B07 lỗi hoặc bị chặn do thiếu runner Redis fixture. Hai lỗi migration xuất hiện ở cả hai nơi. Không dùng tổng pass để xếp chất lượng giữa các entrypoint.

Phân loại: (1) migration crash timeout là **harness identity**: parent không truyền C1_DIRECTORY, child tạo UUID khác rồi không vượt ownership check; parent không xử lý early exit. Rollback CAS sau đó là lỗi dây chuyền do bước apply trước chưa hoàn thành, không có bằng chứng migration ghi sai. (2) B07 thiếu TEST_REDIS_URL là **prerequisite môi trường do entrypoint**, còn validate sau connect và cleanup ngoài try/finally là **harness**; sáu ca sau halted không phải sáu assertion nghiệp vụ độc lập. (3) Lượt unit nháp đầu có 10 pass/2 fail vì matcher không được Jest hiện tại hỗ trợ; đã đổi sang hai assertion tương đương về số lần và đối số trước final snapshot; failed JSON vẫn giữ.

## Sửa tối thiểu

- `tests/helpers/roundC1/crash-barrier.js`: fork chỉ child do helper tạo, truyền C1_DIRECTORY của parent; xử lý early close/error ngay, giữ barrier 30s; kill đúng child handle và chờ close trước kết quả thành công. Cleanup không đóng được là fail riêng.
- `tests/commerceMigrationC1.integration.test.js`: dùng helper trên; giữ nguyên mọi assertion transaction/crash, rerun, CAS, physical preimage và nghĩa vụ được bảo vệ.
- `tests/helpers/redis-bystander.js`: từ chối URL thiếu/không phải loopback rõ port hoặc cùng outage fixture trước khi dựng client; connect/work đều trong try/finally. Không fallback Redis mặc định.
- `tests/operationsB07.integration.test.js`: dùng wrapper trên, giữ mọi assertion outage/no-late-write/recovery và PONG của fixture khác.
- `tests/ciFixtureLifecycle.test.js`: 12 test control-flow unit bằng fake child/client, không được tính là chứng minh hạ tầng thật.
- `tests/helpers/roundC2/run.js`: thêm nhóm kiểm chứng CI không có C1_DIRECTORY kế thừa và giữ inventory thư mục C1 mới. Full runner vẫn cấp Mongo/Redis dùng riêng; không bỏ qua test.

## Evidence và exit code

Run mới: `artifacts/round-c2/72345250-8884-47c2-973f-ac566b5e2712/`. [Kết quả](../artifacts/round-c2/72345250-8884-47c2-973f-ac566b5e2712/fix-result.json), [snapshot](../artifacts/round-c2/72345250-8884-47c2-973f-ac566b5e2712/fix-snapshot.json), [audit](../artifacts/round-c2/72345250-8884-47c2-973f-ac566b5e2712/fix-audit.json).

- Unit cuối: 12/12, exit 0; lượt nháp matcher exit 1 được giữ riêng.
- Nhóm CI harness với Mongo thật và C1_DIRECTORY bị scrub khỏi env runner: **17/17, 0 fail/skip, exit 0**; gồm 5 ca migration thật và 12 unit lifecycle. Ca crash đạt barrier, child đã đóng; rollback CAS/physical preimage và writer preservation đều đạt.
- Lint / format:check / validate:api: **0/0/0**. Lint ghi 18 debt errors, violations=[]; không đổi baseline. Không chạy lại lint:all riêng ở lượt này.
- B01 HTTP: **16/16**, Jest/runner/cleanup **0/0/0**; `http-2vGNFb`.
- B01 full: **841/841, 81 canonical suite, 0 fail/skip**, Jest/runner/cleanup/coverage **0/0/0/0**; `all-Pvjhdh`. Số test tăng 12 do regression lifecycle mới. Cả chín scenario B07 đã chạy với Redis fixture thật.
- Coverage gate: **8 module, 0 failure**; lines 78.98%, branches 70.90%, statements 76.71%, functions 75.44%. Source-bound policy không đổi.
- Snapshot executable không thêm/mất/đổi sau run; SHA256 snapshot `bb97b636a733366de99922b3a825362389bbb83d757120c69710463e17ce9143`. Không build lại hoặc sửa image/runtime source.

## Cleanup, archive và giới hạn nghiệm thu

Audit chỉ đọc: **11 exact container IDs, 0 network mới và 6 volume names absent; 18 port loopback ECONNREFUSED**. Gồm tài nguyên của nhóm migration riêng và full B01. Bốn container cùng mọi image reference lúc entry được giữ nguyên; hai image C2 giữ lại. Không có cleanup mutation bổ sung, prune/FLUSH/name-kill hoặc tác động tài nguyên dùng chung.

Raw archive B01 `all-Pvjhdh/b07-fixture.archive.gz`: 64730 byte, SHA256 `d0e6431d7470cb6a5c8300f6dae3629db208dcedf42c9d80ab557b65b6e1f71c`. Verifier B01 và audit đọc lại bytes, restore chain/runId/empty destination/count/index/relations/session replay/RPO0; không chỉ tin valid=true. Không phải PITR/offsite hay nghiệm thu production.

[Full files và ba nhóm diff hiện hành](../artifacts/round-c2/72345250-8884-47c2-973f-ac566b5e2712/export-current.json). Hành vi BE rỗng; các sửa test/harness/docs thuộc tooling. Lịch sử fail và seal/manifests cũ giữ nguyên checksum. Không chạy lại strict/Phase5/fault/worker hoặc sinh seal mới trong lượt sửa này; không tự mở rộng compatibility để nhận thay đổi shared C1 harness. Cần owner review/commit/push và CI xanh trên commit đó trước kết luận bàn giao cuối; nếu yêu cầu seal mới phải nghiệm thu chuỗi liên kết cho snapshot mới bằng verifier. P2 B-A1-AV01 vẫn mở đúng quyết định owner.

Lệnh nghiệm thu đầy đủ phải là `npm run test:b01:http` rồi `npm run test:b01`; không tự gán URL DB/Redis có sẵn để làm npm test xanh. Kết quả CI cũ vẫn FAIL; bản sửa chưa được commit hoặc chạy remote.

Production: cần nghiệm thu riêng. Dừng sau báo cáo, chờ owner review.

## Lịch sử — giữ nguyên hồ sơ C2 trước bản sửa CI fixture

# C2 — hiện hành 23/10/2026: nghiệm thu local trên snapshot mới

Các gate local và preflight đã đạt trên snapshot **`964baa25ee69e7f38e7e0a7c6c5125ce9d8440929ef806acfd615cc5506ae21f`**. Kết quả xác nhận cuối do verifier xuất tại [verification.json](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/verification.json), [seal command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/seal-latest.txt) và [check command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/check-latest.txt). **Bàn giao FE ở mức local có hiệu lực khi seal và check đều exit 0 trên manifest này.** CI remote còn chờ owner review và tự commit; production cần nghiệm thu riêng. Không coi test BE là browser E2E hoặc quyền deploy.

Cwd `C:/Users/84862/Desktop/totmart/TotMartAPI`, HEAD `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`, tag `check-point-C` giữ nguyên. Không sửa src/FE, commit/push/deploy, A2 hoặc Phase10; giữ mọi thay đổi có sẵn và failed runs.

### Sửa tối thiểu và kiểm chứng hiện hành

Lỗi `no-unsafe-finally` được sửa bằng cách xác minh đường dẫn fixture ngay sau khi tạo, trước khi ghi/đọc fixture. `dir` là hằng; `finally` vẫn luôn gọi cleanup. Không bắt hoặc nuốt lỗi test/cleanup, không disable rule, đổi baseline hay nới assertion. Lượt này chỉ sửa `tests/roundC2Verification.test.js` trong code test; cập nhật hai báo cáo hiện hành và evidence/export. Những sửa discovery/runner/export/manifest/verifier từ lượt trước được giữ nguyên.

- Nhóm nhanh: **111 pass, 0 fail/skip, 4 suite; exit 0**. Gồm discovery thực `--listTests`, evidenceVerification, C2 verifier và roundB close policy.
- Lint gate / format:check / validate:api: **0 / 0 / 0**. Lint không có violation mới; API vẫn 11 operation/8 example.
- **Debt công khai:** lint:all **exit 1**, 18 lỗi cũ/0 warning; policy và baseline không đổi. Đây không phải lint gate fail.
- B01 HTTP mới: **16/16, 0 skip**; Jest/runner/cleanup **0/0/0**, đúng suite HTTP được chọn. [Command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/http/baebfa72-ce42-41b9-bb4c-0291b5c16cd7/command.json).
- B01 full mới: **829/829, 80 canonical suite, 0 fail/skip**; Jest/runner/cleanup/coverage **0/0/0/0**. [Command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/full/86e69689-3f45-4351-a36f-ed940d5da7f9/command.json). Không dùng kết quả 824/824 của snapshot trước để nghiệm thu snapshot này.
- Coverage gate: **8 module/0 failure**. Toàn source: lines **78.98%**, statements **76.71%**, functions **75.44%**, branches **70.9%**. Coverage baseline/policy không đổi. [Coverage](../artifacts/b01/@B01_FULL@/coverage/coverage-summary.json).

### Snapshot, image và khả năng tái dùng gate

[Snapshot mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot.json): **375 file/22 untracked**, ghi delta thêm/mất/đổi và hash hai imported harness legacy; snapshot trước và failed evidence được giữ. Hai báo cáo C2/RC được phép hoàn thiện sau run, nằm ngoài execution comparison; final-source của seal vẫn fingerprint toàn bộ báo cáo hiện hành.

[Verifier linkage](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot-linkage.json) ràng buộc exact hash manifest, command, delta và record copy của từng direct gate. Chỉ chấp nhận chín đường dẫn support được liệt kê cụ thể, không coi mọi tests/ là vô hại. Runtime, shared harness roundB/C1, fixture, dependency/config policy và contract liên quan giữ hash; thay đổi ngoài phạm vi, invocation sai, hash/record thiếu đều có test âm. HTTP/full/quality chạy mới, không dùng compatibility exception. Hai imported harness có **22 copy observations** khớp snapshot và được verifier đọc lại.

Direct gate được tái dùng sau kiểm này: build, strict **21/21**, Phase5 **12/12**, faults **4/4**, workers **5/5**, code91 committed503 → same-key201/một nghĩa vụ. Từng command/cleanup 0, runtime từng backend khớp image mới. Không gọi lại A2 hoặc Phase10.

[Runtime probe mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/runtime/9f7c534c-37f5-41be-9816-cc367d5dad59/runtime.json) **exit 0/cleanup 0**: toàn `src/scripts/package/lock` host khớp image **`sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`**, không overlay. Image giữ build provenance cũ; host Jest config/harness mới được chứng minh riêng bằng snapshot/gate mới. B01 chạy Node24 host, không chạy Jest trong image. Image C2 cũ **`sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55`** cũng được giữ.

### Archive, resource absence và seal

Raw archive `@B01_FULL@/b07-fixture.archive.gz`: **64676 byte**, SHA256 **`7dcbc03038672f55927708e6886c56a207e7af305a68e00e9d5a56891cab05e5`**. Verifier tự đọc bytes, đối chiếu before/after/container restore chain, runId, empty destination, counts/indexes/relations/session replay, RPO0 và gzip hợp lệ. Đây là fixture restore local, không chứng nhận PITR/offsite/production.

[Audit tài nguyên mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/resume-lint-fix/cleanup-current.json), **exit 0**: **11 exact container IDs + 1 network ID absent**, **3 volume names absent**, **11 loopback ports ECONNREFUSED**. Verifier kiểm lại exact ID/tên với live inventory, gồm auth Mongo record độc lập tên file, các port liên quan và volume C1. Tài nguyên gốc, cả hai image C2 và protected seal/backup lịch sử giữ nguyên. Không cần cleanup mutation thêm, không prune/kill hàng loạt/xóa dữ liệu dùng chung.

Preflight **exit 0**. [Seal](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/c2-seal.json) chỉ được sinh bằng `verify.js --seal`, không sửa tay; `--check` đọc lại manifest nguồn/evidence, archive chain và live absence rồi so checksum/summary của seal. Ledger cuối tại verification.json và command pointers ở đầu báo cáo là căn cứ kết luận; thiếu hoặc khác 0 thì chưa bàn giao FE.

[Export hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/export-current.json) trỏ full files và ba nhóm diff hành vi/tooling/format. Hành vi trong bundle chỉ là controller SSE có sẵn từ lượt trước; không có sửa src mới ở lượt này. Export UUID cũ, patches.json, patches-discovery-followup.json, failed lint/full runs và báo cáo lịch sử giữ nguyên.

Tồn đọng có giới hạn: B-A1-AV01 vẫn mở P2 theo nguyên văn owner, không thêm risk acceptance; CI remote trên commit review cuối chờ owner tự commit; browser FE E2E và staging/production, HA/PITR/offsite/on-call/SLO/DR/load cần nghiệm thu riêng. **Dừng sau báo cáo, chờ owner review.**

## Lịch sử — giữ nguyên báo cáo trước lượt sửa lint này


# C2 — hiện hành 23/10/2026: dừng tại lint của verifier bổ sung

**CHƯA đủ điều kiện bàn giao FE.** Nhóm nhanh cuối có **111 pass / 0 fail / 0 skip, 4 suite, exit 0**, nhưng lint **exit 1**: test mới trong `tests/roundC2Verification.test.js:56` ném lỗi trong `finally`, vi phạm `no-unsafe-finally`. Đây là lỗi tooling do lượt này thêm, không phải lỗi môi trường hoặc debt cũ. Tổng lint 19 lỗi gồm 18 debt cũ + 1 violation mới; baseline/policy giữ nguyên. Đã dừng theo cổng yêu cầu, không sửa tiếp code sau gate fail, không chạy HTTP/full mới hoặc preflight/seal/check.

Cwd `C:\Users\84862\Desktop\totmart\TotMartAPI`, HEAD `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`, tag `check-point-C` giữ nguyên. Giữ thay đổi có sẵn; không sửa src/FE, không commit/push/deploy, A2 hoặc Phase10. Controller SSE vẫn có SHA256 `a90bbb36184ae50ff88e1ac4c634f910c306e6c645525bd1ccae7e9860cfdbbc` như lúc vào phiên.

### Nguyên nhân và file xử lý

- Giữ Jest roots chỉ `tests/`; chuyển discovery từ `scripts/jest-discovery.js` về `tests/helpers/roundC2/jest-discovery.js`. Gỡ đúng import/call discovery follow-up khỏi `scripts/verify-be-evidence.js`, trả file này về đúng HEAD/image và giữ mọi kiểm tra gốc. Fixture evidence unit độc lập inventory repo.
- Discovery full khớp toàn canonical suite; HTTP khớp suite được chọn. Từ chối artifacts/full-files/snapshot, thiếu/thừa/trùng/traversal. Regression chạy `--listTests` thật trên repo và fixture riêng, phát hiện config nạp artifact hoặc bỏ suite. Runner đối chiếu thêm suite thực chạy và lưu exit/failed evidence.
- `export.js` nhận đúng config/harness được phép, staged/untracked/deleted; xuất full files/ba nhóm patch vào UUID directory, giữ export cũ. AST kiểm semantic edit để không đưa thay đổi nội dung vào patch format.
- `policy.js/run.js/verify.js` thêm compatibility giới hạn exact path/hash, invocation và snapshot; test âm chặn runtime/shared harness/suite nghiệp vụ/policy/contract thay đổi. HTTP/full luôn cần snapshot chính xác.
- Rà soát sau lượt full phát hiện verifier bỏ sót resource auth Mongo do tên file không chứa “resource”. Bổ sung `manifest.js/verify.js` quét mọi JSON cấp run B01, kiểm ID/tên/port/index fixture và tự kiểm hai fixture legacy theo snapshot/copy hashes. Regression nhận đúng `mongo-auth-deadline-*.json`; lỗi lint hiện hành nằm ở cleanup regression mới này. Bổ sung chưa qua quality cuối.

### Gate, coverage và liên kết snapshot

Chặng đầu đạt 76 rồi 106 test nhanh; lint/format/API từng exit 0. [Snapshot đã chạy](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot.json) có SHA256 **`16c0c27ddaee68f5b2bd3ced498af80a700c77dbb2ffe2c25325f8e186b9184b`**, 375 file/22 untracked, ghi thêm/mất/đổi; snapshot trước được giữ. Đây chưa phải snapshot cuối của tooling hiện hành.

- Nhóm nhanh trên snapshot đó: **106/106, exit 0**. Lint/format/API **0/0/0**; lint:all **1**, đúng 18 debt/0 warning.
- [B01 HTTP](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/http/b3cb5df5-6874-4315-8fc0-71b7fbb67f2c/command.json): **16/16, 0 skip**, Jest/runner/cleanup **0/0/0**, đúng một suite HTTP.
- [B01 full](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/full/b0f6d3a6-8b37-42a6-b016-84f04773ec2e/command.json): **824/824, 80 canonical suite, 0 fail/skip**, Jest/runner/cleanup/coverage **0/0/0/0**. [Coverage gate](../artifacts/b01/all-EEyq6l/commerce-coverage-gate.json): **8 module/0 failure**. Toàn source: lines **78.98%**, statements **76.71%**, functions **75.44%**, branches **70.90%**. Policy/baseline giữ nguyên.
- [Nhóm nhanh hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/verifier-tests/6a5d171e-40a3-488d-a242-6fb8f43aad3c/command.json): **111/111, exit 0**. [Lint hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lint/9cc45676-6633-4554-a5be-ee6372ce61a7/command.json): **exit 1, một violation mới**; output lỗi giữ nguyên.
- **NOT-RUN trên phần bổ sung:** format/API/lint:all, snapshot mới, HTTP/full mới, final preflight/seal/check. Không dùng kết quả snapshot trước thay kiểm chứng hiện hành.

[Delta hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/resume-tooling/cleanup-stop.json) gồm đúng 5 file tooling so với snapshot đã pass: manifest/policy/run/verify và roundC2Verification test. [Linkage đã kiểm](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot-linkage.json) chỉ cho phép tám đường dẫn support cụ thể; toàn runtime/shared harness/config/contract liên quan và invocation direct gate giữ hash. Không coi mọi thay đổi tests/ là vô hại. [Audit imported fixture](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/resume-tooling/imported-harness-linkage.json) có 22 copy observations khớp hai fixture legacy; chức năng tự kiểm vừa thêm chưa có snapshot cuối.

### Image, archive, cleanup và bàn giao

[Runtime probe mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/runtime/2c112765-4b99-47e6-8537-648832600456/runtime.json) **exit 0/cleanup 0**: toàn `src/scripts/package/lock` khớp image **`sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`**, không overlay. Image build mang provenance snapshot cũ; B01 chạy Node24 host, không chạy Jest trong image. Image C2 cũ **`sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55`** cũng được giữ.

[Audit dừng độc lập](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/resume-tooling/cleanup-stop.json), **exit 0**: **11 exact container IDs + 1 network ID absent**, **3 volume names absent**, **11 loopback ports ECONNREFUSED**. Không cần cleanup mutation thêm. Tài nguyên gốc, hai image C2 và protected historical hashes giữ nguyên; không prune/kill hàng loạt/xóa dữ liệu dùng chung.

Archive `all-EEyq6l`: **64877 byte**, raw SHA256 **`b5ac571a34208c9764910fb51c2bb165e58356dc06f1f06ce3816c6877006f6d`**. Audit kiểm raw bytes, before/after/container restore chain, runId/count/index/relation/session replay/RPO0 và gzip hợp lệ. Đây là fixture restore local; final C2 preflight/seal chưa chạy, không chứng nhận PITR/offsite/production.

[Export mới nhất](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/export-current.json) trỏ full files và ba patch hành vi/tooling/format. `patches.json`, `patches-discovery-followup.json`, failed runs và snapshot lịch sử vẫn giữ. Nhóm hành vi chỉ chứa controller SSE có sẵn từ lượt trước, không phải sửa src mới trong lượt này.

**Seal: KHÔNG SINH. BE đủ điều kiện bàn giao FE: CHƯA.** Tồn đọng: xử lý lint mới sau owner review, kiểm lại quality, chốt snapshot đầy đủ rồi HTTP/full + coverage, linkage/absence/archive preflight, seal/check tự sinh. CI remote chờ owner review và tự commit. Production cần nghiệm thu riêng. **Dừng sau báo cáo, chờ owner.**

## Lịch sử — giữ nguyên báo cáo trước lượt tooling này


# C2 — Phase 9 dừng ở B01 full: Jest discovery

## Hiện hành — 23/10/2026, Asia/Bangkok

Owner đã duyệt build image mới chứa sửa SSE và chạy đầy đủ gate, dừng khi gate bắt buộc fail. **Đã dừng đúng tại B01 full exit1; không sửa Jest config/src để chạy tiếp, không preflight/seal/check, không commit, không Phase10 hoặc sửa FE.** Những phần dưới mục lịch sử giữ kết luận cũ theo thời điểm, không phải trạng thái hiện hành.

Cwd `C:\Users\84862\Desktop\totmart\TotMartAPI`; HEAD `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`, tag `check-point-C`, không đổi. Dirty/untracked của người dùng được giữ. [Snapshot cuối](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot.json) phủ src/test/script/config/tooling/workflow/contract và file untracked; phiên bản contract candidate `C2-20261022.1`. Không thay source/test/config sau snapshot này. Báo cáo C2/RC được cập nhật sau run và nằm ngoài execution comparison; chưa có final seal manifest.

Image mới **`sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`**, tag `totmart-b-candidate:c2112d37-753f-4a6a-9337-348f761763d5-final`, digest local `totmart-b-candidate@sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`; [build](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/build/732be47f-f06d-4865-98ae-10902b21ea19/candidate.json). Image đã chứa đúng sửa SSE, không dùng overlay để vượt gate lượt này. Toàn runtime src/scripts/package/lock khớp host; [runtime](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/runtime/c26a3890-997a-4327-ba78-2a5e90ff8855/runtime.json). Host Node24.14.1, image Node24.22.1/user node/UID1000; Mongo7 replica set một node, Redis7.4-alpine TLS và proxy/synthetic provider nội bộ cho container drills. B01 chạy real MongoMemoryReplSet/Redis riêng trên host; không giả rằng Jest chạy bên trong image. Tags hạ tầng không được gọi là pin minor version.

### Matrix và exit code từng bước

- **PASS** cài sạch `npm ci`, exit0, [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/ci/bb0908c8-54f2-4fdc-ba6b-c3ff0dc600f7/command.json); package/lock không đổi.
- **PASS** build image và runtime: từng exit0, cleanup0, fingerprint host/image khớp; image C2 cũ giữ riêng.
- **PASS** lint gate exit0,18 debt/0 violation; **DEBT** lint:all exit1,18 lỗi cũ/0 warning, không nới baseline. [lint](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lint/ec5137e4-1585-495e-ab4c-72062f4c57e0/command.json), [lint:all](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lintall/1036f4eb-ebff-41b4-bd71-f14faa0bc50d/command.json). Đây là debt check theo policy, không được báo lint:all xanh.
- **PASS** format:check0, API validation0; [format](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/format/597e8dc9-f1ec-4ce4-9bbf-c328eb683aaf/command.json), [API](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/api/25d3f0fa-cb0c-4bd6-b88b-fc2aa0283978/command.json).
- **PASS** verifier unit **32/32,0 skip**, exit0; [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/verifier-tests/f88d9468-1180-4234-af20-396f7857e369/command.json). Tooling trước snapshot chỉ cho phép đúng SHA256 controller SSE owner duyệt; vẫn từ chối đổi/thêm/mất file runtime khác. Thêm test âm và mở inventory cleanup cho resource SSE test, không nới transaction/coverage/lint/assertion ứng dụng.
- **PASS** strict container boot **21/21**, runner0/cleanup0; [evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/strict/aa61a71f-a532-439a-8512-07c10791fa0c/phase3-final.json).
- **PASS** Phase5 **12/12**, runner0/cleanup0; [evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/phase5/6a09e333-2fa0-460b-8384-645372d9c8b8/phase5.json).
- **PASS** fault **4/4,0 fail/skip/not-run**, runner0/cleanup0, một fault mỗi lần: Redis stop/start, pause/unpause, Mongo disconnect/reconnect (SSE đóng, HTTP503, recovery same-key201), backend kill/restart. Hai backend từng ca khớp image mới; [evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/faults/682e2278-b40a-47ff-9949-af7e489f4863/faults.json).
- **PASS** code91: đã commit, original503, replay cùng key/body201, một nghĩa vụ, không đòi hai commit; runner0/cleanup0. [evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/code91/eaf80b4b-39d2-4105-9f99-0b27f5e3187b/code91.json).
- **PASS** năm nhóm worker expiry/payment/delivery/notification/security:5 pass/0 fail/skip/not-run, runner0/cleanup0, hai backend runtime hash khớp image từng nhóm; [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/workers/c3759342-d124-45dc-bd51-4d25c4d381b4/command.json). Manual drain/timer điều khiển fixture không chứng minh wall-clock scheduler hoặc mọi lease/clock-skew production.
- **PASS** B01 HTTP thật **16/16,0 skip**, Jest0/runner0/cleanup0; [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/http/f79e7d96-fe39-4fca-ac30-6ac0d88ec10d/command.json), [report](../artifacts/b01/http-ENB7Fk/jest.json).
- **FAIL BẮT BUỘC — harness** B01 full: **Jest1 / runner1 / cleanup0 / coverage0**,8 module/0 coverage failure. [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/full/4882aefa-9340-48a8-8e8c-1f82fbac7ad9/command.json), [exit](../artifacts/b01/all-HUY3Oa/exit.json), [phân loại](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-full-failure.json). Tổng Jest129 suite:85 pass/44 runtime error suite;876 test đã chạy đều pass,0 assertion fail/skip. **Không dùng876 làm test count chuẩn:** canonical `tests/` là **79 suite/777 test pass**, còn `artifacts/` có50 suite (6 pass/99 test,44 lỗi khởi tạo/0 test). Không dùng coverage đang lẫn test lịch sử làm final acceptance.
- **NOT-RUN sau gate fail:** final preflight/restore-chain verifier, seal/check và Phase10. CI remote trên đúng commit review vẫn chờ owner commit. Không dùng lại kết quả B/C1 hay snapshot cũ thay gate còn thiếu.

### Nguyên nhân và đề xuất — chưa sửa tiếp

`jest.config.js` chưa giới hạn roots/testMatch/testPathIgnorePatterns cho artifact. Jest default discovery thực tế đã nạp các bản sao `.test.js` dưới `artifacts/round-c1/.../full-files`, `format-passes`, `format-before/after`, và `artifacts/round-c2/.../full-files/logical`. **Cả44 suite fail đều ở artifact copies, tests=[];79 suite canonical đều pass.** Phân loại **harness discovery/runtime suite initialization**, không phải assertion ứng dụng hoặc thiếu Mongo/Redis. [Danh sách44 suite và cấu hình/defaults](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-full-failure.json). Raw exception từng suite không giữ sau sanitizer, nên chưa khẳng định mọi suite có cùng thông báo require/module.

Đề xuất owner duyệt bước riêng: giới hạn discovery về canonical `<rootDir>/tests`, có inventory regression chứng minh mọi test hiện tại vẫn được chọn và các bản sao artifact bị loại. Không xóa artifact lịch sử, không nới assertions/coverage hoặc đổi baseline. Sau sửa config phải chốt snapshot mới và chạy lại phần liên quan; verifier hiện so manifest toàn execution scope nên không tự tái dùng kết quả lệch snapshot. **Chưa thực hiện đề xuất hoặc rerun.**

Các lỗi thao tác đọc riêng (không phải gate): thử đọc tên helper không tồn tại; nhầm pointer workers-latest.txt là JSON; rg literal tests/* trên Windows. Đều là harness/thao tác, không có mutation; pointer đọc lại đúng exit0. Chi tiết trong failure artifact, không quy thành lỗi môi trường ứng dụng.

### Archive, cleanup, diff và giới hạn

Full đã tạo archive B07 retained host, raw SHA256 **`57bd0ad12ec7ad87d618179c97cc0894b391bfe9dd8fa620a755756ae173b931`**,64735 byte; [observation](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-archive-observation.json). Có evidence backup/restore từ canonical B07 suite nhưng **final verifier restore chain chưa chạy** sau cổng dừng, không gọi hash gzip đơn lẻ là bằng chứng restore hay PITR/offsite. Archive/backup C1 lịch sử và seal A/B giữ nguyên hash.

[Audit độc lập](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-final-cleanup.json), exit0: inventory tổng C2 **163 container IDs +22 network IDs +3 volume names absent**,13 ports ECONNREFUSED. Đây gồm tài nguyên cũ đã absent, không phải số mới của lượt này. [Riêng lượt mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/phase9-attempt-inventory.json): **97 container +13 network +3 volume absent**,9 cổng đóng; từng exact ID/UUID/name đối chiếu resource records và live Docker inventory. Cert UUID directories absent; bốn container/name và image references gốc giữ nguyên. Image C2 cũ `sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55` và image mới đều giữ để review. Không prune/FLUSH/namekill hoặc thay tài nguyên gốc.

[Full files/ba nhóm patch](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches.json): **hành vi** chỉ controller SSE được duyệt từ lượt trước; **tooling/test/docs** gồm toàn bộ C2 đang dirty và phần verifier exact approved hash/inventory bổ sung trước snapshot; **format** tách logical→final, AST equality. Không thêm sửa src trong lượt tiếp này; Jest config, package/lock, coverage và lint policy giữ nguyên. Các export .test.js cũng được giữ làm evidence, không xóa để né discovery.

Rủi ro: (i) **BE trước FE:** B01 full còn fail harness; final manifest/archive-chain verifier/seal và CI chưa đạt, không bàn giao chính thức. (ii) **Contract:** proposal canonical field/index và quyết định các P2 khác chưa tự được chấp nhận; sửa SSE là budget từng read, không hứa hard SLO toàn stream/transaction. (iii) **FE/browser:** unknown5xx/503/timeout giữ key/body và lookup, session/refresh/cookie/CSRF/two-tab/legacy routes cần E2E, chưa sửa FE. (iv) **Owner staging/production:** B-A1-AV01 vẫn P2 theo nguyên văn owner; edge deadline/readiness/p99, A2 nếu còn P2, HA/PITR/offsite/on-call/SLO/DR/load cần nghiệm thu riêng. Không tự ký thêm risk acceptance.

Rubric PDF vẫn chưa nghiệm thu cuối vì gate bắt buộc fail; chưa tự nâng điểm hoặc dùng test count để cộng điểm. Source PDF/trọng số và self-review limitation giữ ở phần lịch sử. Release candidate contract chỉ để review; chưa có CI remote trên commit cuối của owner.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng

**Dừng, chờ owner duyệt bước xử lý harness discovery.**

## Lịch sử — gate Mongo/SSE riêng trước build image mới

## Hiện hành — 22/10/2026, phạm vi riêng Mongo/SSE

**Gate riêng PASS; C2 chưa hoàn tất.** Owner đã duyệt sửa đúng hai read trong `validCredentials`. Cwd `C:\Users\84862\Desktop\totmart\TotMartAPI`; HEAD vẫn `8ff70da85d95a4fc47ab5925cc6fc39646eedfca`, tag `check-point-C`. Không commit, sửa FE, chạy gate còn lại hay sinh seal. Những mục bên dưới phần lịch sử giữ kết luận tại thời điểm cũ, không phải trạng thái hiện hành.

Nguyên nhân đã xác minh: heartbeat chờ User read không có CSOT nên không tới nhánh catch/close; AuthSession read cũng thiếu budget. Watcher cũ tự destroy sau60s từ mở stream, runner tính65s sau HTTP probes; exit0 có thể che record passed:false. Bản sửa dùng hằng `AUTH_READ_TIMEOUT_MS=5000` cho **mỗi read User.findById và AuthSession.exists**; giữ dynamic require, active/role/tokenVersion/sid/expiry/revocation, heartbeat20s, checking guard và cleanup hiện có. Read lỗi trước mở stream đi vào error handler; read lỗi trên stream đã mở đóng stream và dọn registry/timer. Không đổi route/claims/body hoặc transaction/commit; B-A1-AV01 P2 không bao phủ lỗi SSE này.

### Kiểm chứng và phân loại từng lượt

- **RED ứng dụng**, trước sửa src: [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/sse-tests/d19c1278-6c64-4210-930b-b947637ca439/command.json), exit1,7 pass/4 fail/0 skip. Mongo thật giữ find15s; từng User/AuthSession read cả initial và heartbeat mất khoảng14.9–15.1s, timeoutMS null; assertion phát hiện stream chưa đóng hoặc mở sau chờ. Lượt cú pháp trước đó `a101938c-1b79-4662-b66a-c6a5e263f104` exit1 là **harness**, chưa chạy test, không tính là test đỏ ứng dụng.
- **GREEN** sau sửa:11/11 test Mongo thật exit0; lần kế tiếp23/23 exit0; [lần hiện hành30/30,2 suite,0 skip](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/sse-tests/9d515beb-c728-4e34-ad19-ea88947812de/command.json), exit0. Gồm11 test Mongo và19 test harness; không cộng các lần chạy thành tổng mới. Blocked-find từng model trả MongoOperationTimeoutError quanh5s, pending0, cleanup đúng một lần và heartbeat không chồng. Bảy ca quyền/phiên giữ fail-closed. Test này gọi heartbeat thủ công, dùng response/registry spy; không thay thế live HTTP/SSE.
- **FAIL harness sau sửa src**, [lượt9e28](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/9e28c686-f027-4246-b869-8412ba91db8a/command.json), process1/cleanup0. Stream thật đã đóng trong19.195/19.230s qua proxy/direct; read direct trả MongoServerSelectionError sau5005ms. Assertion đòi duy nhất MongoOperationTimeoutError quá chặt với network fault. Đã sửa tiêu chí theo yêu cầu “read lỗi hoặc timeout”: chỉ hai lớp lỗi availability nêu trên, timeoutMS5000, thời gian read<7500ms, query kết thúc, remote end và cleanup vẫn bắt buộc. Có test âm chặn lỗi thường, read chậm/thành công/thiếu CSOT, local destroy, aborted, lệch epoch, passed:false/thiếu result. Không tăng budget/deadline; real blocked-find vẫn bắt buộc MongoOperationTimeoutError. Chưa chốt race nội bộ nào tạo ServerSelectionError ở lượt đó; không coi đây là lỗi môi trường hoặc đổi raw run thành pass.
- **PASS live Mongo fault**, run `f83f60cf-553c-4742-ac41-4c4a12c74017`, [summary](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/5a3626a4-0af0-49d3-81fe-e3a0f5755561/gate-summary.json), [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/5a3626a4-0af0-49d3-81fe-e3a0f5755561/command.json): process0/gate0/diagnostic0/cleanup0. FaultAt **1792685004895**, deadline **1792685069895** =fault+65000ms. Proxy remote end **19323ms**, direct **19364ms**, legacy **21074ms** sau fault. Ba read mất **5002/5002/5002ms**, timeoutMS5000, MongoOperationTimeoutError; server end/finish, heartbeat clear, pending0. Remote end trước mọi local destroy; watcher child/effective exit0 và đúng một passed record. Watcher fail giữ sống qua deadline (tới stop hoặc120s từ fault), không tự hủy để nhận pass.
- HTTP trong live run: health503/not_ready, live200; login503 **5031/5015ms**, checkout503 **5011/5007ms**. Recovery cùng key/body qua hai backend **201/201**, stockOnce/noLateBusinessEffect/recoveryReplay=true; không thấy nghĩa vụ trùng trong fixture này. Không suy rộng thành bằng chứng cho mọi transaction/revocation.
- Lint gate exit0 [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lint/77b4136b-8cd4-47e4-9017-7ee4434b22ee/command.json); format:check exit0 [command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/format/f0598369-b5c4-422a-b4b0-512a4673caab/command.json). Lint:all18 lỗi cũ và kết quả strict/Phase5/API trước sửa src chỉ là lịch sử, chưa tái chứng nhận sau bản sửa này.

[Driver review](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/sse-driver-review.json): Mongoose8.24.5, driver lồng MongoDB6.20.0 hỗ trợ timeoutMS/CSOT, kiểm từ source dependency đã cài và bốn ca find giữ socket thật. Lockfile/policy/threshold không đổi. CSOT giới hạn chờ client; block15s phía Mongo có thể còn chạy sau khi client đã hủy, không dùng tổng thời gian teardown làm thời gian read.

### Runtime, cleanup và giới hạn

Giữ image C2 `sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55` và tag/label cũ. **Image gốc này chưa chứa bản sửa.** Hai backend disposable nhận đúng file controller được duyệt trong writable layer trước app require, kiểm SHA256; toàn bộ runtime src/scripts/package/lock khớp host. [Overlay/runtime](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/5a3626a4-0af0-49d3-81fe-e3a0f5755561/mongo-sse.json). Đây là kiểm chứng giới hạn trên container overlay, chưa thay final image acceptance. Cần build image cuối và chạy phần gate liên quan sau snapshot cuối khi owner cho tiếp.

[Audit độc lập](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/sse-fix-cleanup.json), exit0: **16 exact container IDs +2 network IDs absent**,4 loopback ports đã đóng,0 volume mới; gồm4 Mongo test và hai topology live, không cộng tài nguyên lượt chẩn đoán trước. Cert directories UUID absent. Bốn container/name và image references gốc giữ nguyên; C2 image còn đúng ID/label; hash seal A/B và backup/archive C1 không đổi. Các lệnh cleanup có exit riêng trong resource evidence. Không prune/FLUSH hoặc sửa DB dùng chung.

File sửa chia nhóm tại [patches/full files](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches.json): hành vi chỉ `notificationController.js` (import+hai CSOT read); tooling/test/docs gồm test đỏ/xanh, deadline/exit/transport observer và runner; format tách logical→final với AST equality. Tooling C2 có thay đổi sẵn từ lượt trước, giữ nguyên trong bộ diff tổng. Raw đỏ/fail và báo cáo cũ được giữ, không chỉnh lại lịch sử.

**NOT-RUN theo phạm vi owner:** backend kill/restart, worker5, B01 HTTP/full/coverage, build image mới, các gate còn lại và seal. Chưa có final manifest/restore-chain verification/CI remote cho commit review cuối. Rủi ro còn lại: regression toàn C2 sau source cuối chưa chạy; P2 B-A1-AV01 giữ nguyên chấp nhận owner, A2/staging/production cần quyết định/nghiệm thu riêng.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng

**Dừng sau gate Mongo/SSE, chờ owner duyệt bước tiếp theo.**

## Lịch sử — chẩn đoán trước khi owner duyệt sửa src

## Cập nhật hiện hành — chẩn đoán riêng Mongo/SSE, 22/10/2026

Theo phạm vi owner cho lượt này, chỉ chạy riêng ca Mongo; **không sửa src/FE, không build lại hoặc thay image C2, không commit; không chạy backend kill/restart, worker5, B01 HTTP/full/coverage hoặc sinh seal**. Các phần bên dưới mục “Lượt trước” giữ kết luận tại thời điểm cũ, không thay evidence mới hoặc tự động cấp quyền thực thi.

**Đã tái hiện lỗi ứng dụng trong gate đóng SSE, không phải chỉ lỗi ghi nhận của verifier.** Run mới `f284e264-5e5f-45a8-aa9c-63a4a8948c4e`, [command/exit](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/eb7f0865-3eb3-44c6-8c65-b563b39e6bc0/command.json), [kết luận từ raw timeline](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/eb7f0865-3eb3-44c6-8c65-b563b39e6bc0/diagnosis-summary.json): **process1 / gate1 / diagnostic0 / cleanup0**. Diagnostic0 nghĩa là thu thập quan sát hoàn tất, không phải gate đạt. Lint0 và format:check0 trên tooling mới; chưa chạy lại các gate còn lại.

### Clock, transport và nguyên nhân xác minh

- Giữ watcher cũ và hai hạn60/65s. Watcher tính60s từ response SSE200. Runner bắt đầu65s **sau HTTP probes**, tại epoch **1792675974009**, muộn **28383ms** so với bắt đầu disconnect **1792675945626**. Outer poll fail tại **1792676039233**: **65224ms** chờ, **93607ms** từ fault. Chênh224ms là thời gian poll/exec, không thay ngưỡng.
- Watcher cũ nhận200 tại **1792675941218** rồi **tự gọi destroy** tại **1792676001231**, sau **60013ms**. `aborted/error/close` sau đó là local destroy, không phải server đóng chủ động. Detached child trả process0 nhưng record **passed:false, name:Error**; watch-result không được ghi khi timeout. Đây là khoảng trống chẩn đoán của harness cũ, đã được launcher mới lưu riêng; không dùng exit0 đó để nhận pass.
- Hai stream độc lập, cùng staging backend: một qua HTTPS proxy và một HTTP trực tiếp trong network fixture. Tới hết outer deadline cả hai **closed:false**, chỉ nhận byte mở stream; server cũng ghi **writableEnded:false, socketDestroyed:false**. Proxy chưa nhận upstream end; direct cũng còn mở nên không thể quy lỗi đơn thuần cho buffering proxy/client. [Snapshot trước recovery](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/eb7f0865-3eb3-44c6-8c65-b563b39e6bc0/before-recovery.json).
- Heartbeat20s đã vào `validCredentials`, query **User.findOne** bắt đầu tại **1792675958762/1792675958816**, `timeoutMS:null`, còn pending sau deadline. Driver thực tế: serverSelectionTimeoutMS5000, **socketTimeoutMS0, timeoutMSnull**. `serverSelectionTimeoutMS` không giới hạn read đang đợi I/O trên socket đã có. Source giữ `checking=true` khi await còn chờ; các tick kế tiếp return vì checking, không đi tới close hoặc phát ping heartbeat. Đây là chuỗi nguyên nhân được quan sát trên image không đổi, không suy từ status503.
- Snapshot cuối vẫn có các read này pending **94163/94109ms**, sau khi readiness và recovery nghiệp vụ đã đạt. **Không có query_end được ghi cho chúng; không gán thời gian hoàn tất.** Byte SSE phát sinh sau recovery không được coi là heartbeat/read đã xong. [Quan sát cuối](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/eb7f0865-3eb3-44c6-8c65-b563b39e6bc0/final-observation.json).

Phân loại: **assertion ứng dụng** đối với gate đóng SSE; đồng thời có **harness diagnostic gaps** (clock khác nhau, thiếu watcher error/result khi timeout, child exit0 dù passed:false). Không phải lỗi môi trường và không đổi red run cũ thành pass. Lượt cũ đã mất raw watcher sau cleanup nên không tái dựng chính xác mọi event cũ; run mới tái hiện vấn đề với quan sát độc lập. Fixture chẩn đoán có3 stream thay vì1, giữ dưới cap5; không có workload/load/SLO mới.

Giới hạn: observer ghi Query.exec và trạng thái socket SSE, không ghi Mongo wire commands hoặc nội dung gói tin. Đã xác minh promise read trong heartbeat còn pending và stream thật còn mở; chưa chốt vị trí chờ chi tiết giữa buffering Mongoose và từng phase nội bộ driver/socket Mongo. Không suy từ socketTimeoutMS0 thành một thời lượng treo tối đa, không tuyên bố revocation bypass hay mất/trùng nghĩa vụ từ ca này.

HTTP và nghiệp vụ trong run mới: login503 **5041/4927ms**, create503 **5012/5006ms**, health503/live200. Recovery same-key/body qua hai backend201, đúng một Checkout, stock99, noLateBusinessEffect=true. Không thấy lỗi tiền/kho/idempotency ở phạm vi này; điều đó không làm SSE gate đạt hoặc chứng minh mọi ca revocation. AuthSession read trong cùng hàm cũng chưa có budget theo source review, nhưng fault mới dừng ở User read nên chưa chứng minh nhánh AuthSession bị treo riêng.

### Đề xuất cần owner duyệt trước sửa src

Phạm vi tối thiểu: `src/controllers/notificationController.js`, hàm `validCredentials` (User.findById và AuthSession.exists), dùng cùng CSOT5000ms hiện hành cho **từng read ngoài transaction**. Giữ đầy đủ DB active/role/tokenVersion/sid/expiry/revocation; read đầu timeout phải dừng, không đi tiếp đọc session hoặc cấp stream. Giữ heartbeat20s và nhánh catch đóng stream hiện có, không đặt timeout toàn MongoClient hoặc đổi transaction/commit, route/claims/body.

Patch hành vi riêng cần test đỏ trước: (1) User read bị Mongo giữ I/O thật thì stream server/proxy/direct đều đóng do timeout, có query_end error trước server end; (2) User read đã qua, Session read bị giữ cũng fail closed; (3) initial stream credential validation không mở stream khi read timeout; (4) giữ active/revoked/role/version/session và same-key commerce invariants. Phải phân biệt remote end với client tự destroy, lưu kết quả kể cả fail và chốt chung epoch cho gate; không tăng ngưỡng để nhận xanh. Review ảnh hưởng503 trước khi mở SSE và recovery ticket theo contract hiện hành. Đây **chỉ là đề xuất**, chưa sửa source hoặc tự xác định hard SLO.

B-A1-AV01 owner chấp nhận độ trễ mua hàng trong transaction/commit **không tự bao phủ SSE**. Gate C2 tiếp tục mở; cần triage vấn đề SSE riêng, không tự ký nhận rủi ro, không tự đóng/hạ mức.

### Cleanup và diff lượt chẩn đoán

[Audit độc lập](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/mongo-sse/eb7f0865-3eb3-44c6-8c65-b563b39e6bc0/cleanup-audit.json): **exit0,6 exact container IDs +1 network ID absent,0 volume mới**, cert directories UUID absent. Bốn container và image references gốc giữ nguyên; image C2 `sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55` còn nguyên đúng label. Src/scripts/policies/lockfile/HEAD và hash evidence lịch sử không đổi; hai backend runtime hash khớp host. Audit command đầu exit1 vì quoting PowerShell (**harness/thao tác**, không chạy mutation), lệnh sửa exit0; không nhầm lỗi đó với gate ứng dụng.

**Hành vi BE: rỗng. Tooling:** thêm helper chẩn đoán/client/server/launcher, step mongo-sse trong runner và tùy chọn preload quan sát proxy trong topology (default không đổi). **Format:** full logical/final JS có AST equality. [Full files/ba nhóm diff hiện hành](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches.json). Snapshot execution C2 cũ không được tự coi là snapshot sau các helper mới; lượt diagnostic có manifest riêng. Không hợp thức hóa seal từ kết quả trước thay đổi tooling.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng

**Dừng sau chẩn đoán Mongo/SSE, chờ owner duyệt đề xuất src.**

## Lượt trước — lịch sử trước khi có quan sát độc lập

Hiện hành 22/10/2026, Asia/Bangkok; tiếp tục theo lệnh “Tiếp” sau lượt dừng lint. **Phase9 chưa đạt.** Không chạy Phase10, sinh seal, commit/push/merge/deploy hoặc sửa FE/src. [Báo cáo trước resume](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/review-history/0ef96f74-43b5-4c08-85f0-36c410e0f703/C2-verification-before-resume.md) và các raw failure cũ được giữ.

## Snapshot và runtime

Cwd `C:\Users\84862\Desktop\totmart\TotMartAPI`; HEAD `8ff70da85d95a4fc47ab5925cc6fc39646eedfca` (`check-point 7pm`), tag mới nhất **check-point-C** trỏ đúng HEAD khi resume. Không đổi HEAD; tag round-b-checkpoint-2 là checkpoint cũ. Tree sạch lúc C2 đầu vào; dirty/untracked hiện tại là tooling/test/docs C2 được giữ. B-A1-AV01 còn P2 theo nguyên văn owner trong BE-open-issues; không ký thay hoặc tự điền placeholder. Registry khi vào không có P0/P1 mở khác; lỗi SSE mới dưới đây chưa được chốt nguyên nhân/severity.

[Entry](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/entry.json), [snapshot mới](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/snapshot.json), [contract manifest C2-20261022.1](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/contract-manifest.json). Snapshot cũ giữ trong previous-snapshots. Hai báo cáo kết quả C2/RC được cập nhật sau test, không thuộc execution manifest; chúng phải có mặt trong manifest cuối khi đủ điều kiện seal. Hiện **chưa có seal/manifest cuối được nghiệm thu**.

Image/digest local **`sha256:02d32cb810a60af0cbdc71a515e0abf4992769c9b494f1c0faaa0eef4a60ab55`**, tag `totmart-b-candidate:add0f100-cc31-4de7-ad76-9c6f4fd524f5-final`, label run UUID `add0f100-cc31-4de7-ad76-9c6f4fd524f5`. [Build evidence](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/candidate.json). Node image24.22.1, user node/UID1000, native bcrypt thật; toàn bộ src/scripts/package/lockfile runtime khớp host. Build từ runtime tại HEAD, tooling/docs chưa commit; không gọi working tree là một commit release mới.

Docker29.9.1; host còn104949260288 byte trước build. Fixture topology: hai server.js production/staging, Mongo image tag7.0 replica set một node có auth, Redis7.4-alpine TLS, HTTPS proxy/synthetic credentials nội bộ, không gọi provider thật. Tags hạ tầng không được trình bày thành pin minor version. Mỗi topology có UUID và kiểm ownership exact ID/name/label trước fault/cleanup.

## Matrix hiện hành, exit code và evidence

- **PASS** `npm ci`: exit **0**,120635ms, cài sạch theo lockfile; package/lock/policy giữ nguyên. [Command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/ci/1a14b784-5f34-4d37-bba7-c0d98d9ce91a/command.json).
- **PASS** lint gate: **0**,18 debt/0 violation mới. [Output](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lint/0913ddc8-6a32-4044-ab93-7c1791ac5d31/quality-output.txt).
- **FAIL, debt công khai** lint:all: **1**,18 errors/0 warnings cũ; không đổi baseline. [Output](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/lintall/db96ece7-9e84-40c4-8b1f-b9d523931d99/quality-output.txt).
- **PASS** format:check: **0**; validate:api: **0**,11 operations/8 examples. [Format command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/format/d3929b14-7a23-42f3-b372-983668fffa10/command.json), [API command](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/api/db689a5d-12c3-4077-bb5d-064950e0ba61/command.json).
- **PASS** verifier unit: **0**,26 pass/0 fail/0 skip,2 suites; đây không phải chứng minh hạ tầng. [Command/counts](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/verifier-tests/ac77d273-7b3d-41a3-82f3-fa3b3fc76d7c/command.json).
- **PASS** build/probe: **0**, cleanup **0**,12957ms. Runtime hash probe riêng: **0**, cleanup **0**. [Runtime](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/runtime/7f6d34c9-a243-48fd-92f9-53a7a8e85afc/runtime.json).
- **PASS** strict container boot: **21 pass/0 fail**, exit **0**, cleanup **0**,177907ms; native Linux SIGTERM/SSE, fail-before-listen, TLS/topology/index checks; private certificate files removed. [Report](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/strict/9909fa83-c57b-4a6a-8237-b172c2108229/phase3-final.json).
- **PASS** Phase5: **12 pass/0 fail/0 skip/0 not-run**, exit **0**, cleanup **0**,115697ms; runtimeTreeMatches=true. [Report](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/phase5/28048cb8-7547-4a73-a208-a8f084f67475/phase5.json).
- **FAIL** fault runner: exit **1**, cleanup **0**,294035ms; **2 pass/1 fail/0 skip/1 not-run**. Redis stop/start và pause/unpause PASS; Mongo disconnect/reconnect FAIL ở quan sát SSE; backend kill/restart NOT-RUN. Không gọi ca recovery riêng trong Phase5 là thay thế fault backend chưa chạy. [Raw report](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/steps/faults/925a016c-dcd3-4d60-9cf2-65d5c5b6ef46/faults.json).
- **NOT-RUN do cổng fault:** worker5, code91 regression riêng, B01 HTTP thật, B01 full/coverage, archive/restore-chain verifier, seal/check. Không dùng các lượt B/C1 thay kết quả C2.
- **NOT-RUN:** CI remote trên đúng commit sau owner review/commit; Phase10 chưa được cho phép. Không có skip được tính pass.

Quality chạy trên snapshot mới trước cài sạch lại cùng lockfile; không có thay đổi source/test/config kể từ snapshot trong các gate hạ tầng này. Không nới assertion hoặc cập nhật coverage policy để vượt gate. Sau gate fault1 chỉ đọc điều tra, kiểm kê cleanup và xuất hồ sơ; không chạy gate nghiệp vụ tiếp theo.

## Mongo/SSE: điều quan sát được và phần chưa biết

Run `c843500d-1faf-47c2-a1c0-e834228801ce`, hai backend khớp image/host. Mongo network bị disconnect đúng exact ID; cửa sổ fault tới reconnect **95578ms**. Health trả503/not_ready, live200; login503 **5018/4931ms**, create503 **5020/5010ms**. Sau reconnect, recovery assertions đạt: không có hiệu ứng nghiệp vụ muộn, same-key replay qua hai backend201, stock chỉ trừ một lần.

Tuy nhiên trường `sseClosed` không được ghi; runner bắt `Error` và fail ca. Control flow cho thấy đã qua fault-observe và vào finally recovery trước khi hoàn thành poll SSE. Watcher `fault-client.js` có poll60s rồi destroy trong finally; runner ngoài chờ watch-result65s. Watcher chỉ ghi kết quả khi quan sát closed thành công, không lưu exit/error riêng khi timeout. Vì container đã cleanup, không còn raw watcher để tách lỗi observer với stream phía server. **Phân loại hiện hành: chưa xác định — lỗi gate quan sát SSE sau setup thành công; không phải bằng chứng lỗi môi trường.** Không đổi failed thành pass dù recovery/tiền/kho đã đạt.

Source review chỉ ra heartbeat20s gọi validCredentials, các read User/AuthSession tại notificationController chưa có timeoutMS riêng. Đây là căn cứ điều tra, **chưa chứng minh nguyên nhân của lượt fail**. Không có assertion hoặc timeline phía watcher đủ để kết luận server đã đóng/mở tới thời điểm nào. Không nới60/65s, không bỏ kiểm closure, không sửa src hoặc tự mở rộng risk acceptance mua hàng B-A1-AV01 sang SSE.

Lượt tiếp theo cần evidence phân biệt server closure, proxy/client end/close/error, heartbeat/read đang chờ và watcher exit trên topology mới; giữ red run này. Nếu xác nhận lỗi ứng dụng thì patch hành vi riêng có test đỏ trước, giữ revocation/ownership và contract; không lách gate bằng đổi tên lỗi môi trường.

## Cleanup, archive và bộ diff

[Audit độc lập](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/stop-inventory-resumed.json): exit **0**, **45 exact container IDs +6 network IDs absent**;0 volume mới trong lượt này. Bốn container/name và toàn bộ image references gốc giữ nguyên; hash seal A/B và archive/backup C1 không đổi. HEAD/src/scripts/tooling policies/lockfile giữ nguyên; execution manifest khớp snapshot. Candidate image C2 **giữ lại để review**, không báo image này absent. PDF tool UUID directory đã xóa ở lượt trước. Không prune, FLUSH hoặc cleanup tài nguyên lịch sử.

C2 chưa tạo archive/restore mới. Archive C1 chỉ được bảo vệ hash, chưa tái kiểm restore chain bằng verifier C2; không chứng nhận RTO/RPO production hoặc PITR/offsite. [C1](C1-verification.md) là evidence lịch sử riêng.

Full files/ba patch tại [export manifest](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches.json): **hành vi BE rỗng**; **tooling/test/docs** gồm roundC2 helpers/test, hai roundB helper routing evidence, contract/current reports và bản sao B08 lịch sử; **format** có logical/final riêng và AST equality cho JS. Sửa lần resume: bỏ phép gán thừa export.js, lưu unit counts và giữ snapshot trước. Không áp patch/commit. Chưa có seal xác nhận completeness cuối.

## Rubric và bốn nhóm rủi ro

Đã đọc PDF owner `C:\Users\84862\Desktop\as\TotMart_Lo_trinh_85_BE_FE_va_nghiem_thu_staging.pdf`, render40 trang, đối chiếu trang5/14; [source hash](../artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/pdf-source.json). Trọng số15/20/25/15/15/5/5. Chưa chấm điểm cuối vì Phase9 FAIL; không cộng điểm theo test count hoặc kế thừa điểm lịch sử. **Self-review**, chưa có reviewer thứ hai. PDF còn yêu cầu P2 có owner/acceptance cụ thể, CI/smoke/staging; local pass không thay các cổng đó.

- **BE trước FE:** giải thích/sửa gate Mongo/SSE, chạy fault backend còn thiếu, worker5 và B01 HTTP/full/coverage, verifier/seal sau snapshot cuối. Không kết luận issue SSE được owner chấp nhận.
- **Contract cần quyết định:** C2-20261022.1 là candidate; các P2 khác chưa có quyết định riêng không tự accepted. Canonical field/index còn là proposal C1, không đổi login/merge account.
- **FE/browser:** unknown result create/prepare/terminate giữ key/body và lookup; committed503/replay201 không mở key mới. Cần E2E cookie/CSRF/refresh/session/reload/two-tab/password72-byte/legacy routes; chưa sửa FE.
- **Owner staging/production:** B-A1-AV01 còn P2 đúng phạm vi owner; edge deadline/readiness/p99 chưa xác minh. A2 nếu còn P2, HA, PITR/offsite, alert wiring/on-call/SLO, canonical migration/load cần nghiệm thu riêng. Không ký thay owner.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng

Dừng tại gate fault, chờ “tiếp”.

# C2 — Jest discovery follow-up; stopped at B01 full

Evidence update for the current run, 23 Oct 2026. The pre-fix real Jest listing is preserved in `artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/jest-discovery-before.json`: 129 paths, 79 under `tests/`, 50 under `artifacts/` (11 under `full-files/`). `jest.config.js` was restricted to `tests/`; the post-change `--listTests` evidence lists 80 suites, all under `tests/`, and matches the canonical test-file inventory. The old artifact copies remain intact and were not executed.

The final snapshot was taken after the discovery config/harness edits and formatting. Its executable manifest has no added, missing, or changed paths after the B01 runs. Candidate image remains `sha256:f07e618a9d2764dda88fad76a627901e2540cc7302a1ca5e514d8c576ece4497`; no runtime source or image changed in this follow-up.

Results on that snapshot: discovery check exit 0; verifier/config tests 36/36, exit 0; lint gate exit 0; final format:check exit 0; API validation exit 0; `lint:all` exit 1 with 18 previously recorded legacy errors and 0 warnings. B01 HTTP runner/Jest exit 0, 16/16 tests, but independent evidence validation rejects that HTTP-only subset because the new full-inventory comparison expects every canonical suite. This is a harness validation defect; the HTTP test assertions themselves passed.

B01 full stopped this phase: runner/Jest exit 1, cleanup exit 0; 780 passed, 1 failed, 0 skipped across 80 suites. The failed test is `tests/evidenceVerification.test.js` / `complete fixture passes and hashes archive bytes directly`. The fixture omits suite file paths, while the newly added discovery validation requires them. The B01 runner retains only sanitized test names/statuses and deletes its raw Jest JSON, so the precise Jest matcher error was not retained. From the fixture shape and the new validation call, this is a confirmed harness-test incompatibility, not an application assertion. Coverage returned exit 0 (8 modules, no policy failures), but is not accepted because Jest failed. No gate was rerun after this failure.

A read-only verifier pass confirms the B01 archive checksum and recorded restore-hash chain. Docker inventory was queried read-only after cleanup; all nine exact resource IDs recorded by the HTTP/full B01 and C1 fixture evidence are absent, and runner cleanup exit codes are 0. Inventory evidence is `docker-inventory-after-b01.json`; detailed assessment and separate exit codes are in `discovery-followup-assessment.json`. Original containers and both C2 images were retained.

No seal was generated. The next harness correction needs to distinguish full discovery (exact set of canonical suites) from a deliberately selected HTTP suite, and update the synthetic `verifyRun` fixture to include a canonical suite file. Then rerun affected discovery/verifier tests, quality checks, B01 HTTP and B01 full plus coverage on a fresh snapshot. The C2 archive/restore and absence chain still needs final verifier execution after all required gates pass. The previous failed run and all historical evidence remain preserved.

BE đủ điều kiện bàn giao FE: CHƯA

Production: cần nghiệm thu riêng
Follow-up diff bundle for the discovery change: `artifacts/round-c2/edf18918-a781-4b78-bf44-22412d2a9390/patches-discovery-followup.json`; full current files are under `full-files/discovery-followup/final/`, with separate behavior/tooling/format patch files. The prior `patches.json` and its full-file export are preserved as the earlier snapshot history.
