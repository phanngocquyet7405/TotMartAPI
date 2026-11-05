# BE release candidate — B08 / 20-10-2026

**Local candidate và hồ sơ bàn giao đã hoàn tất trong ngày20/10/2026, Asia/Bangkok; rubric81/100 chưa đạt85.** Đề xuất **CONDITIONAL cho bàn giao contract/local evidence**, chưa GO nghiệm thu FE, **NO-GO production**. Không có confirmed open P0/P1 trong self-review scope; sáu nhóm P2 và các cổng bên dưới còn mở. Owner approval và risk acceptance **pending**. Không commit/push/merge/deploy hoặc chạy shared migration/provider/FE/staging.

## Nhận diện candidate

HEAD nền **`84cef8973f2b2d88fa6d19454dab88fb40bf1c5c`**, working tree dirty/untracked có sẵn B02–B07; HEAD một mình không đại diện candidate. Input256-file digest `23ce3f5f4fb51d2c7259aa988210e5894bdfc174efc1815e4ef531d25d12949c` tại `artifacts/b08/input.json`; input status riêng, được giữ nguyên.

Executable/spec/current-handoff manifest **243 file**, SHA-256 **`bf96b8c9e0e3c8727ae42da94485aae17e5b15a4ddfcb6453e7975343a2b6640`**; hai bản `artifacts/b01/http-yMlKYK/source-sha256.json` và `artifacts/b01/all-sBu6eM/source-sha256.json` khớp complete current inventory sau runner. Bao gồm untracked source/tool/test trong phạm vi, không chỉ Git tracked. Không sửa executable/spec/test sau acceptance.

Machine manifest **`artifacts/b08/release-candidate.json`** ghi exact HEAD, raw dirty tracked diff SHA-256/bytes, toàn inventory path/hash, candidate untracked list (kèm hash), changed/untracked ngoài candidate nếu có, input-preservation checks, run IDs/exit ledgers, config/runtime references, archive chain, CI, rubric và review scope. **`artifacts/b08/final-seal.json`** hash manifest này cùng generated report/hygiene evidence sau khi đóng hồ sơ; không tự nhét hash của một báo cáo vào chính nó. Source fingerprint ở trên không lẫn generated verification report viết sau test.

Contract **B08-20261020.1** /122-file bundle SHA-256 **`df911be1070f05a5fdd6ae326482a541a59068e9c4cb3a0f29290d0a59eabfd6`**, [handoff hiện hành](FE-BE-contract-handoff.md), manifest `artifacts/b08/contract-fingerprint.json`. [Current/historical index](README.md) và [B08 verification](B08-verification.md) giải thích nguồn và giới hạn. FE source421-file fingerprint `2e58715d9be531400d05b7fd53922946e4087f1325e931e562fb26720fab833b` tại HEAD6ecc0fe... được đối chiếu chỉ đọc, có working-tree status riêng; không coi HEAD FE là toàn snapshot dirty hoặc browser proof.

Không tạo source ZIP. Candidate là manifest/reviewable working tree; loại .env, node_modules, ignored artifacts/raw logs/backup archive khỏi Git/source packaging. Không stage/commit các file input hoặc archive. Synthetic backup và sanitized test evidence ở ignored artifacts chỉ để local review.

## Runtime, lockfile và config admission

Node thực24.14.1/npm11.11.0, engine >=24<25. Dockerfile node24-bookworm-slim; CI Ubuntu24.04/setup-node24/npm ci theo package-lock, có devDependencies khi test. Lockfile/runtime src/lint baseline/rules/coverage baseline giữ nguyên so input; không dependency upgrade/audit fix. Không có build script. Docker daemon29.1.3, memory Mongo7.0.14 replica set/WiredTiger, ops Mongo7.0.45/tools100.19.1, Redis image7.4-alpine. Docker image build, production-mode bootstrap và native Linux signal của candidate chưa được chạy trong phiên.

Config từ resolver source, không đọc deployment .env/values. Server mọi mode yêu cầu MONGODB_URI, JWT_SECRET, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET, SEPAY_API_KEY/BANK_ACCOUNT. Staging/production thêm JWT_REFRESH_SECRET, FRONTEND_URL, SEPAY_BANK_NAME, REDIS_URL, REDIS_NAMESPACE, TRUST_PROXY và kiểm public HTTPS origins/Redis TLS/secret khác nhau, đủ độ mạnh; session sid bắt buộc. Trạng thái các biến thật **chưa kiểm**, fixtures có cấu hình riêng do runner cấp; không suy fixture pass thành env production hợp lệ.

Optional runtime knobs: PORT, ORDER_EXPIRY_HOURS, BCRYPT_COST, LOG_LEVEL, CORS_ORIGINS và JWT lifetime keys; validation/default ở [B05 inventory](B05-inventory.md). Actual access JWT dùng JWT_EXPIRES_IN default15m; legacy JWT helper30m/refresh7d không đổi opaque family absolute30d. BREVO_API_KEY/FROM_EMAIL optional ở startup nhưng cần cấu hình/kiểm provider cho reset email hoạt động; optional không phải feature-ready. Các operational target vars B03_MONGODB_URI/MIGRATION_MONGODB_URI/MIGRATION_CONFIRM_DATABASE/ACCEPTANCE_MONGODB_URI thuộc CLI riêng, không lấy env kế thừa để chạy test.

## Ledger kiểm chứng cuối

- **Quality:** `artifacts/b08/quality-final/quality-exit.json`; npm lint0, lint:all1/19 baseline errors/0 warnings, format0/70 selected, API0/11 operations/8 examples.217 JS scanned/58 changed-new sạch. YAML Prettier check0; generated reports có check riêng trong final seal. Không nhận all-source lint sạch.
- **HTTP thật:** `artifacts/b01/http-yMlKYK`,1 suite/16 pass/0 fail/skip,66.409s, Jest0/runner0/cleanup0. Hai backend, real owned Redis và disposable Mongo replica set; subprocess không instrument.
- **Full/coverage/boot/ops:** `artifacts/b01/all-sBu6eM`,69 suites/599 pass/0 fail/skip,346.889s; Jest0/runner0/cleanup0/coverage0. Bao gồm actual src/server.js entrypoint, readiness/index/topology-before-listen, invalid essential config rejection và shutdown qua Windows test bridge; chín ops scenarios và ordinary/mock regressions được phân biệt ở B08.
- **Coverage gate:** `all-sBu6eM/commerce-coverage-gate.json`, policy1/eight modules/no failures; verifier tái tính lại. Critical module ratios và uncovered scope ở B08; không dùng global71.5% statements làm chứng nhận. Coverage1641/2412 branches gồm parent code, không phải E2E subprocess coverage.
- **Hậu kiểm:** `artifacts/b08/final-verification.json`, CLI verifier exit0, same243-file complete manifests, required artifacts/status recount/restore chain/coverage/resource absence đạt. Test fixture negative mismatch/missing archive không chạm archive gốc. Jest exit và runner/gate/cleanup exit được ghi riêng.
- **CLI failure branches:** `artifacts/b08/verifier-cli-fixtures.json`; copied complete fixture exit0, checksum-mismatch fixture exit1, missing-archive fixture exit1, đúng reason/valid flag và archive gốc unchanged. Đây là kiểm admission, không thêm một restore/thí nghiệm nghiệp vụ độc lập.
- **Audit production:** `artifacts/b07-close/audit-production.json`, npm audit --omit=dev --audit-level=high exit0,0 vulnerabilities; dùng lại theo lockfile/dependency unchanged, không suy dev-tree audit hiện tại từ báo cáo cũ.
- **Cleanup:** `artifacts/b08/resource-inventory.json` read-only43 exact IDs đều cleaned=true và absent;26 lịch sử +17 ID do phiên này tạo. Không xóa container cũ/unowned hoặc audit PID toàn OS. Owned MongoMemoryReplSet/children/sink dừng theo handle. Archive được git-ignore; không shared volumes/flush/prune.

Các acceptance B07-close trước đó được giữ tại [B07 supplement](B07-verification.md); B08 rerun là cần thiết vì CI/current handoff/manifest scope thay sau B07. Không dùng full572 hoặc full599 của snapshot242-file để chứng minh candidate243-file. Không chạy dedicated ops thêm vô ích sau full cuối đã bao phủ nó.

## Backup/restore và performance evidence

Archive hiện hành **`artifacts/b01/all-sBu6eM/b07-fixture.archive.gz`**, run **all-sBu6eM**, **64,628 bytes**, raw SHA-256 **`e707cc95e677eb8501024b4f5d84c01d03192d71fc6ea0997809c442fbea87f6`**. Evidence `all-sBu6eM/b07-evidence.json` backup-restore và verifier cùng run/hash, host/container trước/sau restore bằng nhau. Restore retained file vào destination empty/new namespace, không --drop.23 collections/index options/document fingerprints/relations/global và checkout ledger/session/replay/tombstone/pinned version checks đạt.

Quiesced writers/worker children, marker trước dump. Dump455ms, restore including transfer/hash1495ms; observed local RTO4326ms qua verification/destination HTTP/close; quiesced-marker fixture RPO0. RTO không gồm phát hiện outage, provision host/secrets/DNS/routing, production worker/provider validation. Không chứng nhận live-writer backup, encryption/offsite/retention/PITR hoặc production RTO/RPO.

Historical mismatch giải thích bằng EJSON Buffer hash bee928... so raw1009... của cùng file; không sửa artifact gốc để khớp. Lượt mới dùng raw-byte checksum và restore retained file. Profile cũ max20/actual40 giữ là sai lệch; profile40/concurrency2/max30s được công bố trước rerun. Current load40 samples/0 errors/p50-p95=10/59ms, stock−2/coupon+2/one allocation mỗi purchase/pending notification0. Manager benchmark/explain/tie pagination và limitations ở B08. Không runtime timeout/cache/index tuning hoặc production SLO claim.

## Migration/index order — chỉ là kế hoạch cần owner duyệt

1. Xác minh target/topology/data owner/quyền, exact code/config/index catalog và dữ liệu legacy; có protected backup/restore clone được kiểm chứng. Chốt writer quiescence/ingress receipt preservation/window/rollback với finance/platform trước thao tác. Document này không cấp quyền và phiên không làm các bước shared.
2. Identity: scan collision/invalid/index options và lập manifest quyết định account; giữ exact unique email. B03 tool shared chỉ dry-run; apply tự động chỉ cho owned disposable. Không gọi capability đó để lách vào production, không tự merge account hoặc drop index. Name unique cũ có thể còn dù schema bỏ unique; duplicate registration có thể503 tới khi quy trình được duyệt thực hiện.
3. Review merchant/commerce ownership và flag conflicts qua migrate-merchant-ownership/migrate-commerce-integrity; không transfer nghĩa vụ từ brand mới. Missing/null preimage phải được quyết định trước apply. Review migrate-box-version-fields và historical snapshot evidence; không chế tạo purchased components/BoxVersion thiếu. Clone drill không chứng nhận mọi legacy row thật.
4. Legacy checkout reconstruction `migrate-checkouts.js` là insert-only; payment ledger classification `migrate-payment-ledger.js` không phải bank reconciliation. V1 pending money cần bằng chứng/review trước production. Không flip paid/version để qua startup hoặc tự xóa Checkout đã hoạt động.
5. Với exact target/manifest đã được duyệt: drain incompatible writers, backup/check preimages, apply nhóm đã chọn trong đúng transaction/CAS, lập lại dry-run và kiểm ledger/relations/session/tombstone. Index creation chỉ additive sau review: Checkout user/key/paymentCode; Attempt user/kind/key và createdAt không TTL; receipt reference/provider identity; allocation event; audit/refund key/reference; BoxVersion box/version; fulfillment sequence; AuthSession sid/current hash/history/expiry TTL. Giữ unique email; không sync/drop đại trà. Startup phải fail nếu index/topology/ledger preconditions không đạt.
6. Mở đồng bộ writer hiểu B04 sid/revocation và commerce tombstone; không mixed old/new writers. Sau approval mới làm smoke được phép ở target: readiness/auth/session, prepare-before-hash recovery, created replay, quota, money/refund/stock/coupon/outbox. Chưa chạy staging hoặc gọi provider thật trong phiên này.

## Rollback/CAS và điều code rollback không phục hồi được

Code rollback bằng inverse patch đã review đối với dirty input, giữ B01–B07 user work; không git reset. Không quay về writer bỏ qua revokedAt/sid/tombstone, không phục hồi refresh ancestor hoặc reset token đã dùng. Giữ stable refresh secret across instances; key rotation cần kế hoạch revoke/login lại.

Data rollback chỉ theo exact preimage/postimage CAS; writer edit chen vào phải từ chối, không clobber. Safe subset cần review riêng, không xóa conflict để tạo green plan. Commerce manifest cũ missing→null chưa presence-preserving; cần owner quyết định trước dùng thật. Checkout insert-only không có rollback xóa tự động; không xóa record đã có activity.

Không thể chỉ rollback code để khôi phục email raw trước migration, bcrypt suffix legacy chưa từng hash, unique-name index khi đã có tên trùng, purchased snapshot lịch sử thiếu, stock/receipt/refund/transfer đã commit hoặc tác dụng phụ outbox/provider đã xảy ra. Email cần private preimages/CAS/collision review; password không hạ cost/khôi phục bí mật cũ. Khoản hoàn thật cần bank evidence, restore backup không thay reconciliation của writes/receipts sau checkpoint. Retain attempt/replay/audit/ledger references, không delete/TTL để mở quota.

## CI, rubric và cổng bàn giao

Remote GET exact HEAD có [push run39352834561 success](https://github.com/phanngocquyet7405/TotMartAPI/actions/runs/39352834561). Candidate chưa commit nên **CI đúng candidate chưa có**; CI xanh HEAD cũ không chứng minh dirty tree. Workflow candidate đã thêm tracked verifier sau HTTP/full, nhưng remote execution của step đó chưa được kiểm. Không push/trigger deployment để lấy job xanh.

Rubric: architecture13/15, security/session17/20, business/data23/25, reliability/ops9/15, test/CI12/15, performance3/5, documentation4/5 = **81/100**; evidence/deductions và uncovered scope tại [B08](B08-verification.md). **Chưa đạt85**. Không chấm thêm từ599 tests, % coverage hoặc tên file. No confirmed open P0/P1 trong self-review scope; P2-01–06 và acceptance gaps tại [open issues](BE-open-issues.md), mỗi mục có trigger/impact/source/reproduction scope/regression/role đề xuất/quyết định pending.

FE đã có immutable reference/body recovery/new purchase/refresh coalescing trong source. Phần bắt buộc review tiếp: password byte-limit/legacy notice và reset400 mapping; browser multi-tab/lost response/session/SSE/TLS/proxy phải thực chạy ở đợt được phép. Local API/source pass không nghiệm thu browser. Owner cần chốt identity/migration semantics, alert wiring/channel/on-call, workload/SLO/recovery/protected backup, candidate CI và policy release. Không tự nhận rủi ro thay owner.

Đã hoàn tất BE local implementation/verification/handoff trong phạm vi được giao ngày20/10/2026. Phần không hoàn tất là rubric85/GO FE nghiệm thu/production readiness: thiếu CI đúng uncommitted candidate, owner decisions và môi trường/quyền kiểm chứng FE/staging/provider/HA/PITR. Không viện deadline để bỏ test hoặc giảm tiêu chí. Dừng sau B08; không bắt đầu sửa FE hoặc staging.
