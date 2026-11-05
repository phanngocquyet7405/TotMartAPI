# B05 supplemental refactor and response contracts

Status: **B05 supplemental acceptance passed locally** on the snapshot below. B06 may now proceed under the user's latest instruction. The earlier 64-suite/548-test result is historical, not evidence for this changed snapshot. This supplement supersedes the API coverage counts in the original B05 inventory/report.

## Input and interrupted work

HEAD remains `84cef8973f2b2d88fa6d19454dab88fb40bf1c5c`. Input status and 235 path digests are in `artifacts/b05-close/input.json`; aggregate SHA-256 `aa16e53582da90f93ecb506d2d1bf56d028750de4ce0f620078b8148c3eb6e57`. Comparing the two old HTTP/full manifests independently confirmed identical 218-file manifests, all matching this input. Their 548 tests and exit 0 remain historical.

After the model interruption, status/diff and the three edited runtime files were read again. Exactly authController.js, sessionService.js and server.js differed from the captured input. The named helper extraction was present, formatting and response assertions were unfinished, and no tests had run after that extraction. No patch was blindly repeated or input reset. Parent/root instructions were checked; no nested AGENTS.md was found. Earlier dirty/untracked B01–B05 changes remain.

## Reviewed changes

- Session service names the rotation/recovery decision and transactional family revocation. Current hash, cap 4096, two duplicate allowances strictly inside 30 seconds, current-successor binding, HMAC-SHA384 domain and absolute 30-day expiry are unchanged. Result/revocation variables still reset on every retried transaction callback. Family save and security outbox remain in that transaction; local stream termination remains after commit. Dynamic requires remain.
- Auth controller names expired-session rejection and the legacy password notice; multiline formatting exposes login, CAS rehash, cookie, logout and reset branches. Response/status/cookie/CSRF and JWT name/email/sid claims are unchanged.
- Server names ledger readiness, collection/index/topology readiness and worker startup. Order remains config validation before app import, connect, ledger checks, model initialization, additive index creation, topology check, Redis start, listen, then workers. Production-only ledger checks retain their prior scope. No index drop or topology bypass.
- OpenAPI adds the existing admin receipt-refund completion operation; no runtime route or alias was added. Auth error and attempt envelopes now have explicit schemas. Refund amount is a positive safe integer VND, completion status is fixed, id and replay marker are constrained. Different checkout-kind `result` payloads remain explicitly partial.
- Existing integration tests now validate actual response bodies against operation/status schemas through a helper that only emits operation/status on failure. It never dumps response bodies, JWTs or cookies. Business assertions remain: bounded retry/revocation, created result preservation, no order on invalidated attempt, refund denial with identical before/after document and no audit, replay with exactly one completion audit.

Logical phase hashes are `artifacts/b05-close/refactor-before-format.json`; formatting then touched only these edited files. No lint rule/baseline/dependency changes. The only old test expectation changed is the declared OpenAPI operation count 10 to 11, because the existing admin refund operation was documented. Assertions were added, not removed. No persisted schema/index/config admission or business policy change is included in this supplement.

## Contract coverage and limits

Actual response schema assertions cover login 200/401; refresh 200 including bounded replay and 401 reuse; product prepare 200; attempt lookup 200 unknown, 400 invalid reference, 409 mismatch; hash termination 200 invalidated; body termination 200 invalidated/created; admin receipt-refund completion 200/replay, 400 invalid evidence, 403 ordinary user, 409 amount/payload mismatch. Existing middleware tests also check unauthorized/CSRF errors.

Not fully contract-tested: locked-login 403, auth 429/503, every attempt state/error/status, subscription-specific prepare/body response schemas, detailed nested checkout results, product checkout creation response, webhook response, legacy order-refund completion response and complete catalog/manager/subscription API. Runtime business tests do not imply those responses were validated against OpenAPI. The generic Error schema retains documented extensions for validation/request IDs; it is not used to relax refund amount or auth-success envelopes. Schema validation initially rejected an empty `required` array; omitting it for the optional Mongoose error subdocument fixes OpenAPI syntax with the same intended optional-field semantics.

FE was read only at the supplied path. Axios refresh uses cookie/CSRF and checks the returned subject; attempt and reconciliation callers use the existing routes. No name/email claim removal or caller migration is required. Existing `subcribe` and `check-out` route spelling is retained. No FE writes.

## Verification record

Initial lint gate exit 0, 204 scanned, 19 old debt errors. After edits: lint gate exit 0, 205 scanned, 42 changed/new, zero violations; format check exit 0, 49 selected; API validation exit 0, 11 operations/8 synthetic examples. `lint:all` exit 1, the same 19 old errors/0 warnings. Logs and individual exit codes are in `artifacts/b05-close/`. Baseline was not changed. The first API validation exit 1 is retained here; fixed as described above. HTTP's first sandbox attempt failed Docker spawn EPERM; the approved disposable runner was then used.

`npm run test:b01:http`: 1 suite/12 pass/0 fail/0 skip, 66.144s, Jest and runner exit 0, `artifacts/b01/http-z1Rnli`. `npm run test:b01`: 64 suites/551 pass/0 fail/0 skip, 259.009s, Jest and runner exit 0, `artifacts/b01/all-HKLdtY`. These are newly executed results after the refactor and assertions. The full suite includes boot through the actual server entrypoint, real disposable Mongo replica set and separate Redis lease, essential invalid-config rejection and clean shutdown. Windows uses the documented test-only IPC-to-SIGTERM bridge. HTTP uses two app processes and separate real Redis. Ordinary unit/mocked tests and local proxy fixture remain distinct; none is staging verification.

Both runs have the same 219-file executable/spec manifest, SHA-256 `49f594a430a63a927a1cacc26074e266a63171df4751d0588aeb299f3374d1c0`. `node artifacts/b05-close/verify.cjs artifacts/b01/http-z1Rnli artifacts/b01/all-HKLdtY` exit 0 independently rehashed every manifest path, checked baseline/lockfile unchanged and confirmed all five recorded Redis IDs cleaned and absent. `artifacts/b05-close/verification.json` contains exact per-run counts, exit codes, resource metadata and path delta. Generated evidence reports and ignored artifacts are outside the executable/spec manifest. B01–B04 historical documents/policy hashes remain equal to input. `git diff --check` exit 0.

Coverage is a new baseline, not a quality score: statements 3150/4439, branches 1624/2412, functions 455/656, lines 2848/3877. HTTP subprocess runtime is not instrumented. No new threshold was inferred from the count.

## Migration, rollback and boundaries

No migration/index/dependency change is required by this supplement. The B04 legacy session transition, stable refresh secret across instances, strict staging/production sid admission and revocation-aware rollback remain in [refresh-family-policy.md](refresh-family-policy.md). Roll back this supplement only with a reviewed inverse patch against the captured dirty input; never reset B01–B04 or downgrade to code ignoring revocation. Recheck the same acceptance commands. No commit/push/deploy/shared data operation occurred. CI, staging and production remain unverified.
