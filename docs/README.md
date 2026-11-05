# Documentation index

## Current contracts and operating policy

- [B08 BE release candidate](BE-release-candidate.md), [final verification/rubric](B08-verification.md), [current FE contract handoff](FE-BE-contract-handoff.md) and [open issues/owner decisions](BE-open-issues.md): current 2026-10-20 handoff; local scope, owner approval pending. The B07 closure supplement supersedes its historical archive/profile/finality claims; older batch stop instructions are historical under the user's later B08 request.

- [B07 operational runbook](B07-operations-runbook.md), [drill matrix](B07-drill-matrix.md) and [proposed release/migration plan](B07-release-plan.md): disposable local scope; no rollout authorization.

- [Unified commerce contract](UNIFIED-COMMERCE-CONTRACT.md): business API policy; read alongside source.
- [Checkout attempt contract](checkout-attempt-contract.md): idempotency and restart/recovery.
- [Manager API](MANAGER-API-CONTRACT.md) and [merchant operating model](MERCHANT-OPERATING-MODEL.md).
- [Refresh family policy](refresh-family-policy.md): B04 security state machine, retention, legacy transition and rollback.
- [B05 inventory/config/tooling contract](B05-inventory.md): current resolver, env, lint and format scope.
- [B06 invariant and evidence map](B06-invariants.md): source contracts, financial equations, ownership, recovery and benchmark scope; see verification for run status.
- [OpenAPI sensitive subset](api.openapi.json) and [synthetic examples](api-examples.json): automatically validated partial contract; not complete route coverage.
- [Operations](../OPERATIONS.md): deployment and operational constraints; source wins over contradictory historical examples.

## Verification and historical evidence

- [B08 verification](B08-verification.md): current self-review and acceptance; no independent-review or production certification claim.

- [B07 verification](B07-verification.md): current operational drill status, failures, restore/CAS evidence and unverified scope.

- [B06 verification](B06-verification.md): current commerce verification status, manifests, limits and performance evidence.
- [B05 supplemental verification](B05-supplement-verification.md): passed local refactor and actual-response acceptance; supersedes the original B05 snapshot.
- [Original B05 verification](B05-verification.md): retained historical execution record, including 548-test snapshot and failures.
- [B04 verification](B04-verification.md): current security baseline evidence; unchanged by B05 business policy.
- [Earlier selected refresh run](refresh-family-verification.md): historical selected-run record, superseded as final evidence by B04.
- [B03 verification](B03-verification.md), [B02 verification](B02-verification.md), [B01 verification](B01-verification.md): retained snapshots, failures and limitations, not current test results.
- [B02 route inventory](B02-route-inventory.md): historical route inventory; recheck current router source before assuming coverage.

Historical documents and failed-run artifacts are retained. A later successful run does not change a historical failure or prove CI/staging/production readiness.
