# B05 — tooling, configuration and review

Later acceptance: [B05 supplemental refactor and response contracts](B05-supplement-verification.md) supersedes this report's final snapshot/counts and stop instruction under the user's later B06 authorization. The evidence below is retained as historical.

Status: **B05 passes the declared local acceptance scope**: lint baseline gate, format check, OpenAPI/examples, real Redis HTTP 12/12, real server boot and full regression 64 suites/548 tests; 0 failures/skips, runner exit 0. All-source lint still has 19 disclosed grandfathered errors. CI/staging/production are unverified. Stop after B05, not B06.

## Input and scope

Read applicable AGENTS.md and source/script/test/CI/Docker callers; FE inspected read-only at the supplied path. HEAD `84cef8973f2b2d88fa6d19454dab88fb40bf1c5c`, existing dirty/untracked B01–B04 preserved. Input manifest [input-snapshot.json](../artifacts/b05/input-snapshot.json): 219 files, SHA-256 `1bddd6b30ae3a58ced9264ee24fdd5ac59a646b3061c92746510631d10251ddd`. Original status is in that file. HEAD diff includes earlier work; B05 changed-file/hash comparison is against this input, not HEAD.

Current inventory, defaults/requirements, caller limits and admission differences: [B05-inventory.md](B05-inventory.md). Current/historical index: [README](README.md). [B04 policy](refresh-family-policy.md) and [B04 verification](B04-verification.md) remain authoritative for security behavior; their bytes and B01–B03 evidence were checked unchanged in [historical-preservation.json](../artifacts/b05/historical-preservation.json).

No response/status/cookie/CSRF, ownership, role, idempotency, commerce state machine, transaction boundary, persisted schema/index or FE changes. No aliases added. Preserve source asymmetries: strict staging sessions do not silently enable production-only idempotency-key/legacy-money gates. No data migration required or run. No commit/push/deploy.

## Separated changes

1. Tooling config and pre-refactor lint baseline: pinned ESLint 10.13.0/@eslint/js 10.0.1, Prettier 3.9.10, Ajv 8.17.1, swagger-parser 10.1.1; package/lock controlled. No runtime dependency version changes versus HEAD; [dependency-review.json](../artifacts/b05/dependency-review.json). Registry rejected cache-only metadata reads in sandbox; approved registry reads/install succeeded. ESLint 9 was marked unsupported during setup, replaced before baseline publication. Install reports 20 moderate advisories across the dev tree; no audit fix/unrelated upgrade.
2. Pure resolver/config consumers: resolveEnvironment(env), immutable validated snapshot, dotenv only at server entrypoint. Refactor hashes before formatter: [refactor-before-format.json](../artifacts/b05/refactor-before-format.json). This records the earlier tooling pin before the subsequent Prettier-only update; it is not the final source manifest.
3. Format phase limited to 43 B05 code/JSON/new inventory/index files: [format-phase.json](../artifacts/b05/format-phase.json). Prettier debug-check verified AST/idempotence before writes. One response object needed multiline input to avoid a reproducible Prettier non-idempotence bug in both 3.6.2 and 3.9.10; field values/status unchanged. A fixture computed-member chain conflicted with no-unexpected-multiline after formatting; introduced client/path locals, preserving its 403 assertion. No inline ignores or rule disables added.

Config admission differences are separate from refactoring: empty/invalid numbers, duration units, enums and URL shapes now fail explicitly instead of fallback/coercion; essential server fields validate before app/provider import; runtime env mutation is not hot reload. Error text includes only key/reason. Production/staging required fields/TLS/secret separation and B04 sid policy remain fail-closed. Actual access JWT exp-iat is tested against configured lifetime; opaque refresh family remains absolute 30 days regardless of legacy refresh helper env. Legacy JWT helper defaults/exports retained; only tracked local unexported database.maskUri was removed after caller review. No dependency/field/schema deletion based merely on an absent literal caller.

## Lint/format policy and results

Initial baseline: 23 errors, 0 warnings across 196 JS files: 19 unused bindings and one each no-useless-catch/no-useless-escape/no-case-declarations/no-unsafe-finally. Baseline collection exit 1; initial diagnostic collector exit 0 is not a lint pass. CLI initially reported three additional false __dirname errors from dynamic globals; explicit static globals fixed the tooling configuration before baseline publication, preserving initial evidence. No source error was hidden.

Original issue ledger/byte hashes remain in tooling/lint-baseline.json; [pre-LF copy](../artifacts/b05/lint-baseline.pre-lf.json) preserves evidence before metadata extension. Three old debt files were CRLF on Windows. A byte-only gate would incorrectly reject an LF Linux checkout, so matching normalizes only CRLF→LF. All 23 original issue records remain; changed/paid-down files have null LF exemption and must stay clean. No trimming or token/whitespace normalization. Formatter scope uses a separate LF digest map; original input hashes are intact. Tests verify LF equivalence, code/space inequality and actual new untracked-error rejection with CI=true/false.

- `npm run lint`: exit 0, scans all 204 JS files; 36 changed/new files, no violations. Old debt remains 19 errors on unchanged files.
- `npm run lint:all`: exit 1, 19 known old errors, 0 warnings. This is disclosed debt, not “all lint passes”. Four initial issues were removed by reviewed local cleanup; baseline ledger was not reduced.
- `npm run format:check`: exit 0, 43 selected files, no invalid formatting. Acceptance runs check only. Historical files are not broadly formatted.
- `npm run validate:api`: exit 0, 10 OpenAPI operations/6 synthetic examples. Swagger structure validation, Ajv schema validation and runtime Joi request validation all run; app middleware error contract tests are additional.

Quality semantic policy/version hash is pinned; changing rules needs explicit review. CI runs npm ci, lint gate, format check and spec/examples validation before audit/HTTP/full. Manifest matching includes untracked/new files, without relying on a merge base. Node/CommonJS/Jest globals and callback argument/caught-error exceptions are explicit; variable declarations remain checked. CI itself has not run for this uncommitted work.

## Executed verification

- Early selected config/security suites: exit 1, 47 pass/2 fail because the old sessionPolicy test expected a boolean even for invalid strict config. Changed it to assert failure instead of sid-less fallback; valid strict config is separately checked by pure resolver tests. No runtime policy weakened.
- Pre-format selected: 11 suites/121 pass/0 fail/0 skip, exit 0. Includes real server boot, disposable Mongo/Redis and config/JWT/API/security regression.
- Pre-format `format:check`: exit 1 (files not formatted yet). Debug-check sandbox process spawn returned EPERM; approved run exposed real formatter non-idempotence, fixed layout rather than adding ignore. Intermediate lint then caught no-unexpected-multiline in a fixture; preserved assertion while shortening the expression. Intermediate failed checks are not acceptance passes.
- HTTP `artifacts/b01/http-NFhWBC/`: 12 pass, exit 0, 68.040s. Subsequently corrected documentation/spec about conditional production idempotency header, not runtime.
- HTTP `artifacts/b01/http-lUQt2V/`: 12 pass, Jest/runner exit 0, 66.892s.
- Full `artifacts/b01/all-qeF5wp/`: 64 suites/547 pass/0 fail/0 skip, Jest/runner exit 0, 276.592s. This precedes LF portability metadata and strengthened startup diagnostics; not final acceptance.
- Selected quality/boot after LF change: 2 suites/9 pass/0 fail/0 skip, exit 0, 10.178s. Essential startup cases now isolate missing fields and check the actual diagnostic key, rather than accepting an arbitrary startup failure.
- Final HTTP `artifacts/b01/http-K3ljFc/`: 1 suite/12 pass/0 fail/0 skip, Jest/runner exit 0, 64.388s.
- `npm ci`: exit 0, 578 packages installed from the lockfile; source/lock snapshot unchanged. Install reports 20 moderate advisories and a transitive glob deprecation; no audit fix or claim that all dependencies are vulnerability-free.
- Final `npm run test:b01`, `artifacts/b01/all-TcXykN/`: **64 suites/548 passed/0 failed/0 skipped**, Jest/runner exit **0**, 254.407s. Includes 12 real Redis HTTP cases, 3 real Redis primitives, 6 real entrypoint cases, 3 quality gate cases and the existing regression suites. Tests that use mocks remain mocks.
- Final checks after full exit: lint gate 0, format check 0, spec/examples 0, all-source debt lint 1 (expected 19 old errors). [quality-exit.json](../artifacts/b05/quality-exit.json). No source/config/spec/test edits after the final HTTP/full snapshot.

## Real entrypoint and evidence boundaries

serverBoot.integration starts the actual src/server.js, not app.js, with fixture-only env, noDotenv preload, its own MongoMemoryReplSet 7.0.14/WiredTiger and its own Redis 7.4 Alpine tmpfs container. It checks health 200, actual replica-set topology and auth history/unique indexes, then exit 0 through graceful shutdown. Negative children reject invalid port/Mongo URL, missing Cloudinary server field, missing strict Redis and missing strict refresh secret before readiness; only diagnostic key booleans are asserted, no stderr/token values are published.

On Windows, test-only preload IPC invokes the registered SIGTERM handler because kill() bypasses Node signal listeners; Linux branch sends actual SIGTERM but was not executed here. Boot succeeds under NODE_ENV=test with real plain Redis; not a production/staging TLS boot. Pure tests cover valid strict config and real entrypoint negative tests cover essential strict rejection. Workers are the real server workers on an empty disposable DB; no business records/provider targets or real credentials are supplied.

HTTP suite keeps two backend processes with real shared Redis/Mongo, B04 response-loss/restart/reuse/SSE/outage scenarios and ownership-verified container actions. Proxy fixture remains two local HTTP servers simulating TLS termination; mocked timer/SSE tests are not real Redis proofs. Startup fixture, HTTP fixture and primitives fixture each have distinct ownership/ID/binding; only those leases are stopped/removed. No shared DB/Redis, volume pruning or bulk process kills.

## Final snapshot, cleanup and changed files

HTTP/full have identical **218-file manifests**, covering source, tests, scripts, tooling baselines/input fingerprints, CI workflow, package/lock, root JS/formatter config, Dockerfile and current spec/examples/inventory/index. Manifest SHA-256: `77a2b212f734680051e7244ad87eebd38eb8b9093dcf23b8162484b3555a44a0`. Recomputed after exit: 0 missing/new/mismatched files. Generated verification report and ignored local artifacts are outside this executable/spec manifest; original input additionally captures root instructions/README/history.

`node artifacts/b05/verify-final.cjs` exit 0, [final-verification.json](../artifacts/b05/final-verification.json) valid=true. It confirms baseline issue ledger/original byte hashes retained, all 14 input documents unchanged, and no runtime version/integrity/resolved dependency changes. All 12 recorded Redis IDs across the HTTP/full runs have cleaned=true/tmpfs=true and are absent. The two selected boot leases also completed their ownership-checked cleanup; read-only Docker label inventory shows 0 remaining harness containers. Only owned child handles/lease IDs were stopped; no shared volumes/data/processes were removed.

Artifact scan of all five B05 HTTP/full run directories and B05 evidence: 0 JWT, credential-URI, private-key or raw 96-hex refresh patterns. This is pattern checking plus isolated synthetic fixtures, not a general secret-audit certificate. No environment contents, raw requests/cookies/tokens or provider error bodies are published. New validation/startup errors use key/reason or dependency/event/type only.

Full coverage baseline: statements 70.71% (3132/4429), branches 66.92% (1613/2410), functions 69.18% (449/649), lines 73.14% (2819/3854). No threshold or quality/production-readiness score inferred. HTTP coverage does not instrument child processes. `git diff --check` and direct generated-report formatter check exit 0 after documentation completion.

Detailed B05-only path/hash delta is `changedFromInput` in the summary (49 paths, plus this generated report). Groups:

- Tooling/CI: package.json/lock, eslint.config.cjs, .prettierrc.json, tooling baseline/input hash files, scripts/quality.js, scripts/validate-api.js, scripts/run-be-tests.js, .github/workflows/check.yml.
- Config/refactor: src/config resolve/environment/checks/database/redis/sessionPolicy; src/server.js/app.js; provider config consumers in box/product/user controllers, checkoutLifecycle/paymentReconciliation/password services, sepay/error middleware and brandLogoStorage/idempotencyKey/jwt/logger/sendEmail utils. No model/schema/index edits.
- Tests: resolveEnvironment, serverBoot, quality, apiContract and server-signals preload; existing authBoundary/environmentChecks/security/sessionPolicy/refreshFamily/sessionProxy fixtures adapted for immutable config without weakening status/ownership/reuse assertions.
- Docs/instructions: AGENTS.md, root README pointer, docs/README.md, B05-inventory.md, OpenAPI/examples and this report. B01–B04 uncommitted source changes remain; no clean HEAD-only B05 diff is claimed.

## Limits and rollback

OpenAPI is a documented sensitive subset with open detailed business response data; examples plus middleware contracts do not prove every emitted business response. Full subscription/manager/catalog coverage is not claimed by this spec. Existing integration tests remain separate evidence. No staging/browser/TLS-cookie-jar/provider/HA/clock-skew or GitHub CI validation, no production readiness score.

Rollback tooling/config with an explicitly reviewed inverse B05 patch; do not reset the dirty input or revert B01–B04. Preserve B04 sid/revokedAt/TLS/family policy and fixed family expiry; no data/index rollback or migration is needed. Reinstall the reviewed lockfile, recheck runtime env admission/defaults and rerun the same acceptance checks. Input/path/phase hashes distinguish B05 edits; no claim that HEAD alone contains a clean B05-only PR.

No native Linux/GitHub CI run, production TLS Redis boot, startup failure on a shared legacy index dataset, or live environment inventory was attempted. Windows newline portability is tested at the fingerprint algorithm and CI/local gate level, not presented as a completed Linux job. Existing provider error paths outside configuration/startup and B03 logging are not newly certified. Stop after B05.
