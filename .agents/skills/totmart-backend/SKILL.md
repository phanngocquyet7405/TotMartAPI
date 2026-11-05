---
name: totmart-backend
description: >-
  Runbook and operational skill for developing, testing, maintaining, and verifying
  the TotMart Backend API. Use this skill whenever inspecting commerce transactions,
  running tests, debugging checkout/inventory/payment reconciliation, or modifying
  TotMart BE source code.
---

# TotMart Backend Development & Verification Skill

This skill contains the operational procedures and commerce invariant runbook for working on TotMart BE (`nodejs-mvc-backend`), built with Express 5, Mongoose 8 (MongoDB), and Redis.

## 1. Environment & Architecture Overview

- **Node.js**: Requires Node `>=24 <25`.
- **Infrastructure**:
  - `src/server.js`: Infrastructure connection, index/topology validation, worker startup.
  - `src/app.js`: Express app and middleware setup.
  - `src/routes/`: Route declarations mounted under `/api`.
  - `src/controllers/`: HTTP request handling.
  - `src/services/`: Core business logic (checkout, pricing, inventory, payment reconciliation, merchant scoping, session management).
  - `src/models/`: Mongoose schemas and indexes.
  - `src/jobs/`: Schedulers (delivery, expiry, payment reconciliation, outbox).
  - `tests/`: Jest test suites (unit, integration, manager, B01 harness).

## 2. Standard Commands & Verification

| Command | Purpose |
| :--- | :--- |
| `npm test` | Run Jest test suite (experimental VM modules, runInBand) |
| `npm test -- --runTestsByPath <path>` | Run a single test file |
| `npm run test:manager` | Run manager integration and merchant order policy suites |
| `npm run test:b01:http` | Run B01 HTTP integration suite |
| `npm run test:b01` | Run full B01 suite |
| `npm run test:b01:unit` | Run B01 unit harness |
| `npm run lint` | Run quality check with baseline comparison (must pass without violations) |
| `npm run lint:all` | Show all historical lint debt |
| `npm run format:check` | Verify formatting via Prettier |
| `npm run validate:api` | Validate OpenAPI schema and contract |

> [!WARNING]
> Do NOT run `npm run migrate:checkouts` or `npm run migrate:merchant-ownership` on production data. These are operational migration scripts, not default setup steps.

## 3. Commerce Invariants & Non-Negotiable Rules

1. **Transaction Integrity**:
   - Keep related state changes (stock, coupon, order, checkout, ledger, outbox) within the same MongoDB transaction session.
   - Never call external side-effects (e.g. email, webhooks, non-idempotent third-party APIs) directly inside transaction retry loops.
   - Preserve unique indexes: `Checkout` `{userId, requestKey}` and `CheckoutAttempt` `{userId, kind, key}`.

2. **Idempotency**:
   - Bound to authenticated `userId`, `kind`, `key`, and request payload hash (`req.validatedBody`).
   - Identical payload replays previous outcome; modified payload under the same key must return a conflict (409).

3. **Inventory & Coupon Safety**:
   - Stock updates must be conditional (no negative inventory, no double-deduction on retries/webhooks).
   - Coupons must respect `usageLimit` and `usedCount`, releasing at most once per checkout upon cancellation/expiry.

4. **Payment Reconciliation & Ledger**:
   - All financial operations must record `PaymentEvent`, `PaymentAllocation`, `PaymentAudit`, and `ReceiptRefund`.
   - Never artificially mutate `paid: true` or bypass reconciliation.
   - Refunds require dedicated idempotency keys, transaction locks, and available balance checks.

5. **Authentication & Multi-Tenant Scoping**:
   - Enforce `isActive`, `tokenVersion`, and session validity from database state (never rely solely on stale JWT claims).
   - All merchant and user queries must strictly enforce identity boundaries via `merchantScope` and ownership checks. Cross-tenant queries are forbidden.

## 4. Verification & Reporting Protocol

- When finishing tasks, report:
  1. Modified files list.
  2. Actual test commands executed with pass/fail/skip counts.
  3. Verified boundaries and any unverified edge cases.
- Never claim tests passed if they were skipped, mocked without execution, or blocked by environment prerequisites.
