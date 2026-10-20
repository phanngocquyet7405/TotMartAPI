# Refresh family verification — 2026-10-20

Node v24.14.1. Final run: 9 suites passed, 64 tests passed, 0 failed, 0 skipped.

Executed:

```text
npm test -- --runTestsByPath tests/refreshFamily.integration.test.js tests/sessionProxyFixture.test.js tests/sessionPolicy.test.js tests/cookieSessions.integration.test.js tests/streamLifecycle.test.js tests/securityOutbox.integration.test.js tests/passwordResetStreams.test.js tests/authBoundary.integration.test.js tests/security.test.js
git diff --check
```

MongoDB is a real local disposable MongoMemoryReplSet (7.0.14), created and cleaned by the test helper. Initial sandbox run failed setup with spawn EPERM (12 tests failed setup, 2 unit tests passed); rerunning with approved process permissions succeeded. No application MongoDB/Redis targets were used. Recovery test launches two separate Node processes, passing the disposable DB URI and credential over stdin only; workers return only acceptance and successor digest, then disconnect.

Covered: same-token concurrency; lost response simulation; recovery across processes; durable retry count and time window; ancestor reuse after successor rotation; unknown credential isolation; expired records denied before TTL; family-specific access denial and other-device preservation; outbox rollback atomicity; 4096-entry admission cap; staging sid rejection on HTTP/admin and SSE tickets; local SSE family closure and DB heartbeat fallback after missed signal; startup failure for missing strict-environment configuration; preserved name/email claims.

Reverse proxy fixture: two loopback HTTP servers simulate TLS termination through overwritten X-Forwarded-Proto=https. Checks forwarded secure protocol, Secure/HttpOnly/SameSite cookies, clearing cookie attributes, CSRF header and CORS/preflight using actual application middleware. This is NOT real TLS/browser cookie-jar verification or staging verification. No authorized staging endpoint was provided or contacted. No real Redis, cross-instance Pub/Sub outage drill, real unknown-commit network injection, browser multi-tab test, full B01 harness, audit or complete repository test run in this task. Existing Redis outage health checks and outbox retry behavior remain; their timing was not newly verified against live Redis.

Files changed for this task (other pre-existing work was preserved):

- `src/config/sessionPolicy.js`, `src/config/environment.js`: shared strict staging/production policy and startup validation.
- `src/models/AuthSession.js`, `src/services/sessionService.js`: indexed bounded hash history, durable revokedAt, transactional deterministic successor and bounded retry.
- `src/controllers/authController.js`, `src/middleware/authMiddleware.js`: delegate refresh and enforce family state on access.
- `src/controllers/notificationController.js`, `src/utils/notify.js`, `src/config/redis.js`, `src/services/securityRevocationService.js`: family-scoped stream/ticket revocation and DB validation.
- `tests/refreshFamily.integration.test.js`, `tests/helpers/refresh-child.js`, `tests/sessionProxyFixture.test.js`, `tests/sessionPolicy.test.js`, `tests/cookieSessions.integration.test.js`.
- `docs/refresh-family-policy.md`, this report, `OPERATIONS.md`, `docs/UNIFIED-COMMERCE-CONTRACT.md`: policy, operational cutover/rollback and updated staging contract. Previous contract mentioned production-only sid enforcement; updated to match strict staging behavior.

FE source at the supplied path was readable and inspected only; no FE files changed. No raw refresh credentials were persisted in DB, logs or generated artifacts. No commit, push, deployment or real-data migration was performed.
