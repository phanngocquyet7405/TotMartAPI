[Current contracts, tooling and historical verification index](docs/README.md) · [Route naming debt and modernization roadmap](docs/route-naming-debt.md)

# TotMart API

Backend API for **TotMart**, a Vietnamese organic-products e-commerce platform. Built with Node.js 24, Express 5, and Mongoose 8 on a MongoDB replica set with Redis 7.4 shared caching and state synchronization.

Companion frontend (Next.js) lives in a separate repository.

---

## Architecture & Technology Stack

- **Runtime**: Node.js `>=24 <25` (tested on Node 24).
- **Framework**: Express 5.
- **Database**: MongoDB 7.0+ (requires **Replica Set** for multi-document ACID transactions).
- **Cache & Shared State**: Redis 7.4 (fail-closed rate limiting, session revocation, and cluster concurrency control).
- **Payment Gateway**: **SePay** VietQR bank transfer with real-time webhook reconciliation and idempotent double-entry ledger.
- **Logging**: Pino / Pino-HTTP with strict automated redaction of tokens, credentials, and sensitive markers.

---

## Project Structure

```
src/
├── config/                  # Configuration & startup validation
│   ├── database.js          # Mongo replica set connection with bounded timeouts
│   ├── environment.js       # Environment configuration loading
│   ├── environmentChecks.js # Production boot preflight checks (TRUST_PROXY, secrets, etc.)
│   ├── redis.js             # Redis client and Pub/Sub connection
│   ├── resolveEnvironment.js# Environment variable resolution with safe defaults
│   └── sessionPolicy.js     # Shared store session enforcement policy
├── controllers/             # HTTP controller handlers
│   ├── adminCommerceController.js # Admin order fulfillment & inventory hold endpoints
│   ├── authController.js    # Authentication, password reset, and session control
│   ├── cartController.js    # Optimistic concurrency-protected cart operations
│   ├── checkOutController.js# COD & Online checkout orchestrations
│   ├── managerController.js # Merchant catalog & brand management
│   ├── reconciliationController.js # Payment reconciliation & manual ledger settlement
│   └── ...
├── jobs/                    # Periodic scheduled background workers
│   ├── deliveryScheduler.js     # Processes due subscription box deliveries
│   ├── notificationOutboxScheduler.js # Dispatches async notification events
│   ├── orderExpiryScheduler.js  # Cancels unpaid online checkout sessions
│   └── securityOutboxScheduler.js # Drains and revokes invalidated auth sessions
├── middleware/              # Express middlewares
│   ├── authMiddleware.js    # JWT verification, active user checks & live DB session validation
│   ├── cookieCsrf.js        # SameSite cookie CSRF protection
│   ├── errorHandler.js      # Centralized error handler with strict error disclosure prevention
│   ├── rateLimiter.js       # Redis-backed fail-closed rate limiters (auth, checkout, two-tier webhook)
│   ├── sepayAuth.js         # Constant-time timing-safe SePay API key validation
│   ├── validationHandler.js # Joi request validation (body, query, params)
│   └── validationSchemas.js # Joi schemas for commerce, auth, and catalog
├── models/                  # Mongoose models with strict indexes and revision fencing
├── routes/                  # Express route definitions
├── services/                # Pure business logic services
│   ├── boxDefinitionService.js  # Combo box versioning & immutable snapshot pinning
│   ├── checkoutAttemptService.js# Attempt fencing, admission quota & recovery tombstones
│   ├── inventoryService.js      # Atomic conditional stock reservations & adjustments
│   ├── managerCatalogService.js # Merchant-scoped catalog management
│   ├── merchantScope.js         # Authenticated identity merchant isolation
│   ├── orderFactory.js          # Unified order creation factory for COD & Online settlement
│   ├── paymentReconciliationService.js # SePay payment reconciliation & double-entry ledger
│   ├── pricingService.js        # Quote builder, bulk discount tiers & quota fingerprints
│   └── subscriptionService.js   # Subscription template & fulfillment lifecycle
├── utils/                   # System utilities (transaction wrapper, logger, safe redaction)
├── app.js                   # Express application setup
└── server.js                # Server entrypoint with topology check & worker bootstrap

tests/                       # 89 test suites, 919 automated tests
├── helpers/                 # Test helpers (ephemeral Mongo replica set, disposable Redis runner)
├── cartConcurrencyAndValidation.test.js # Cart concurrency & validation verification
├── cartSync.test.js         # LocalStorage cart synchronization tests
├── checkout.test.js         # Order creation & checkout attempt tests
├── checkoutSessionFlow.test.js # End-to-end checkout session and webhook tests
├── commerceInvariants.integration.test.js # Atomic stock, ledger, and attempt invariants
├── orderCharacterization.integration.test.js # Parity test between COD and Online settle
├── proxyAndWebhookRateLimit.test.js # Trust proxy validation & two-tier rate limiting
├── transactionTimeout.integration.test.js # Mongo timeout bounds and 503 recovery
└── ...
```

---

## Prerequisites

- **Node.js**: Version `>=24 <25`.
- **MongoDB**: Replica set deployment required (standalone `mongod` does not support multi-document transactions). A local single-node replica set is provided automatically by test helpers via `MongoMemoryReplSet`.
- **Redis**: Redis 7.4+ (required in production/staging for shared rate limiting, session revocation, and account locking).
- **SePay Account**: For online VietQR payments and webhook confirmation.

---

## Installation & Setup

```bash
# 1. Install dependencies
npm ci

# 2. Copy and configure environment variables
cp .env.example .env

# 3. Start local development server (Node watch mode)
npm run dev
```

---

## Environment Variables

| Variable                       |    Required    |    Default    | Description                                                              |
| :----------------------------- | :------------: | :-----------: | :----------------------------------------------------------------------- |
| `PORT`                         |       No       |    `3000`     | HTTP listening port                                                      |
| `NODE_ENV`                     |       No       | `development` | `development`, `production`, or `test`                                   |
| `MONGODB_URI`                  | **Yes (prod)** |       —       | MongoDB connection string (must point to a replica set)                  |
| `MONGO_SOCKET_TIMEOUT_MS`      |       No       |    `45000`    | Bounded socket read/write timeout in ms                                  |
| `MONGO_WAIT_QUEUE_TIMEOUT_MS`  |       No       |    `5000`     | Pool connection wait queue timeout in ms                                 |
| `MONGO_MAX_COMMIT_TIME_MS`     |       No       |    `10000`    | Transaction commit deadline in ms                                        |
| `MONGO_TRANSACTION_TIMEOUT_MS` |       No       |    `15000`    | Overall transaction execution deadline in ms                             |
| `JWT_SECRET`                   | **Yes (prod)** |       —       | HMAC secret for access token signing                                     |
| `JWT_EXPIRES_IN`               |       No       |     `15m`     | Access token lifespan                                                    |
| `JWT_REFRESH_SECRET`           | **Yes (prod)** |       —       | Secret for refresh token signing                                         |
| `JWT_REFRESH_EXPIRES_IN`       |       No       |     `7d`      | Refresh token lifespan                                                   |
| `BCRYPT_COST`                  |       No       |     `10`      | Salt rounds for native bcrypt hashing (10–14)                            |
| `FRONTEND_URL`                 | **Yes (prod)** |       —       | Primary web URL for password reset links & default CORS                  |
| `CORS_ORIGINS`                 |       No       |       —       | Comma-separated allowlist of permitted origins                           |
| `TRUST_PROXY`                  | **Yes (prod)** |       —       | Required in production: `1` (behind proxy/Render/Nginx) or `0`           |
| `TRUST_PROXY_CONFIRMED_DIRECT` |       No       |    `false`    | Set `true` if `TRUST_PROXY=0` is intentional on direct internet exposure |
| `REDIS_URL`                    | **Yes (prod)** |       —       | Redis connection URL (`rediss://...` in production)                      |
| `REDIS_NAMESPACE`              |       No       |     `tm`      | Prefix key namespace in shared Redis instance                            |
| `SEPAY_API_KEY`                | **Yes (prod)** |       —       | Secret key required in `Authorization: Apikey <key>` on webhooks         |
| `SEPAY_BANK_ACCOUNT`           | **Yes (prod)** |       —       | Bank account number for QR code generation                               |
| `SEPAY_BANK_NAME`              | **Yes (prod)** |       —       | Bank short name for VietQR code generation                               |
| `ORDER_EXPIRY_HOURS`           |       No       |     `24`      | Hours before an unpaid online order expires                              |
| `BREVO_API_KEY` / `FROM_EMAIL` |       No       |       —       | Transactional email provider for password resets                         |
| `CLOUDINARY_*`                 |       No       |       —       | Cloudinary cloud credentials for brand logo & image uploads              |

---

## Available Scripts

```bash
# Development
npm run dev             # Start with Node.js watch mode

# Production
npm start               # Start HTTP production server

# Quality & Linting
npm run lint            # Incremental lint gate against baseline
npm run lint:all        # Full codebase ESLint scan (must report 0 errors)
npm run format:check    # Check Prettier code style compliance
npm run validate:api    # Validate OpenAPI specifications and examples

# Testing
npm test                # Run Jest tests in-band
npm run test:b01:unit   # Unit harness tests (no Docker needed)
npm run test:b01:http   # HTTP process integration with real Redis & Mongo
npm run test:b01        # Full BE regression suite (89 suites, 919 tests)
npm run test:manager    # Manager and merchant policy test suites
```

---

## Security & Reliability Design

1. **Transaction Safety**: All order creation, stock adjustments, coupon deductions, payment ledger records, and outbox queues are serialized within MongoDB replica set transactions with bounded timeouts (`MONGO_MAX_COMMIT_TIME_MS: 10s`).
2. **Idempotency & Replay Protection**: Checkout attempts and SePay webhooks enforce strict client-request keys and SHA-256 payload hashes (`requestHash`). Identical requests safely return previous commitments; altered requests with conflicting keys return 409.
3. **Two-Tier Webhook Limiter**: Pre-auth flood protection (300 req/min/IP) protects the network edge, while post-auth business quota (60 req/min/IP) prevents forged attacks from exhausting valid SePay quota.
4. **Optimistic Concurrency on Cart Operations**: Cart item updates and subscribe cart operations implement retry loops with jittered backoff on `VersionError` to prevent lost updates under high concurrency.
5. **No Blind Trust in Client Identity**: User status, tokenVersion, and session revocation are verified against the database on every authenticated request.
