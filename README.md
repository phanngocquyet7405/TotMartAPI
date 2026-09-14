# TotMart API

Backend for **TotMart**, a Vietnamese organic-products e-commerce platform. Node.js + Express + MongoDB (Mongoose), MVC architecture. The companion frontend (Next.js) lives in a separate repository.

## ⚠️ Payment provider note

This backend integrates **SePay** (bank-transfer QR code + webhook), not VNPay. If your frontend or documentation elsewhere references VNPay, that integration does not exist in this codebase — either it needs to be built, or the reference is stale and should be corrected. Confirm which is the case before go-live; shipping with a frontend that expects a VNPay redirect against this backend will break the online-payment flow.

## Project structure

```
src/
├── config/
│   ├── database.js        # MongoDB connection
│   └── environment.js     # Env vars, with required-var validation in production
├── controllers/           # Business logic (checkout, cart, products, users, ...)
├── models/                # Mongoose schemas
├── routes/                # Express routers, one per resource
├── middleware/
│   ├── authMiddleware.js     # JWT auth (authMiddleware + adminMiddleware)
│   ├── sepayAuth.js          # API-key auth for the SePay webhook (timing-safe compare)
│   ├── rateLimiter.js        # Rate limits for auth / checkout / webhook routes
│   ├── validationHandler.js  # Joi request validation
│   └── errorHandler.js       # Centralized error formatting
├── jobs/
│   ├── orderExpiryScheduler.js  # Auto-cancels unpaid online orders after ORDER_EXPIRY_HOURS
│   └── deliveryScheduler.js     # Processes due subscription-box deliveries
├── utils/
├── app.js                 # Express app (middleware + route wiring)
└── server.js              # Entry point — connects DB, starts schedulers, listens

tests/
├── env.setup.js           # Test env vars (loaded before any module via jest setupFiles)
├── helpers/
│   ├── db.js               # In-memory MongoDB replica set lifecycle (connect/clear/close)
│   └── factories.js        # Test data builders (user, brand, product, cart, coupon)
├── security.test.js        # Auth/CORS/helmet/webhook-auth tests — no DB required
├── rateLimiter.test.js     # Rate-limit behavior — no DB required
├── checkout.test.js        # Order-placement integration tests — requires MongoDB
└── webhook.test.js         # SePay webhook integration tests — requires MongoDB
```

## Prerequisites

- Node.js v18+ (developed against v22)
- MongoDB **replica set** (required — `checkOutController` uses multi-document transactions via `session.withTransaction()`, which MongoDB only supports on a replica set, not a standalone `mongod`). A single-node replica set is enough for local dev.
- A SePay account with a webhook configured (Api_Key auth type) if you need to exercise the online-payment path end to end.

## Installation

```bash
npm install
cp .env.example .env
# fill in .env — see the "Environment variables" section below
npm run dev
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to 3000 |
| `NODE_ENV` | no | `development` / `production` / `test`. Production enforces the required-vars check below. |
| `MONGODB_URI` | **yes (prod)** | Must point at a replica-set-enabled deployment |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | **yes (prod)** | Access token signing |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN` | **yes (prod)** | Refresh token signing |
| `FRONTEND_URL` | **yes (prod)** | Used to build reset-password links, and as the CORS fallback if `CORS_ORIGINS` is unset |
| `CORS_ORIGINS` | no | Comma-separated allowlist of origins permitted to call this API. Falls back to `FRONTEND_URL` if unset. **Do not leave this open to everyone in production.** |
| `BREVO_API_KEY` / `FROM_EMAIL` | no | Transactional email (password reset) |
| `CLOUDINARY_*` | no | Image uploads |
| `SEPAY_API_KEY` | **yes (prod)** | Shared secret the SePay webhook must send as `Authorization: Apikey <value>` |
| `SEPAY_BANK_ACCOUNT` / `SEPAY_BANK_NAME` | **yes (prod)** | Used to build the payment QR code URL |
| `ORDER_EXPIRY_HOURS` | no | Hours an unpaid online order is kept before auto-cancel (default 24) |

`src/config/environment.js` throws on startup if `NODE_ENV=production` and any required var above is missing — the app refuses to boot rather than run with unsafe defaults.

## Running

```bash
npm run dev      # nodemon, auto-reload
npm start        # production
npm test         # Jest test suite (see below)
```

Health check: `GET /api/home/health`.

## API surface (by router)

All routes are mounted under `/api`. Endpoints requiring auth expect `Authorization: Bearer <token>`.

| Base path | Router | Covers |
|---|---|---|
| `/api/home` | `homeRouter` | login, logout, forgot/reset password, health check |
| `/api/users` | `userRouter` | register, profile, addresses, admin user management |
| `/api/checkout` | `checkOutRouter` | order placement, SePay webhook, cancel, refunds, COD confirmation |
| `/api/carts` | `cartRouter` | cart CRUD, plus subscription-box cart |
| `/api/products`, `/api/brands`, `/api/categories`, `/api/boxes` | — | catalog management |
| `/api/subcribe-plans` | `subcribePlanRouter` | subscription box plans |
| `/api/coupons` | `couponRouter` | coupon CRUD (admin) |
| `/api/admin/notifications` | `notificationRouter` | admin order/payment notifications (SSE) |

### Order placement & payment flow

1. `POST /api/checkout/check-out` — creates one `Order` per merchant represented in the cart, inside a DB transaction. `paymentMethod: "cod"` deducts stock immediately; `paymentMethod: "online"` defers stock deduction until payment is confirmed and returns a SePay QR URL.
2. `POST /api/checkout/sepay-webhook` — called by SePay when a bank transfer arrives. Authenticated via a static API key (`Authorization: Apikey <SEPAY_API_KEY>`, timing-safe compared), rate-limited, and idempotent on `referenceCode`. Underpayment is flagged for manual reconciliation rather than silently accepted or rejected.
3. Unpaid online orders are auto-cancelled by `orderExpiryScheduler` after `ORDER_EXPIRY_HOURS`.
4. `POST /api/checkout/cancel/:_id` — owner or admin can cancel a `pending`/`processing` order; restores stock and coupon usage, and flags a refund if the order was already paid.
5. Admin: `POST /api/checkout/confirm-cod/:_id`, `POST /api/checkout/mark-cod-delivered/:_id`, `GET /api/checkout/pending-refunds`, `POST /api/checkout/complete-refund/:_id`.

## Testing

```bash
npm test
```

Two of the four test files (`security.test.js`, `rateLimiter.test.js`) need nothing but Node — they cover auth rejection, CORS, security headers, and rate-limit behavior.

`checkout.test.js` and `webhook.test.js` spin up an **in-memory MongoDB replica set** via `mongodb-memory-server` and need outbound internet access the first time you run them (to download the `mongod` binary, cached afterwards under `~/.cache/mongodb-binaries`). If you're on a network that blocks that download, either run on a machine with normal internet access, or point `mongodb-memory-server` at a locally installed `mongod` via `MONGOMS_SYSTEM_BINARY=/path/to/mongod`.

These tests also cover a regression: order placement previously used a misspelled field name when looking up the user's cart (fixed in this change — see below), which meant `check-out` could never find an existing cart and always failed with "cart is empty."

## Security notes

- **Rate limiting**: applied to `/login`, `/register`, `/forgot-password`, `/reset-password` (10 req/15 min), `/check-out` (30 req/15 min), and `/sepay-webhook` (60 req/min) — see `src/middleware/rateLimiter.js`.
- **Helmet**: standard security headers are applied to all responses.
- **CORS**: locked to the `CORS_ORIGINS` allowlist (comma-separated), falling back to `FRONTEND_URL`. Requests with no `Origin` header (webhooks, server-to-server calls) are always allowed through; browser requests from origins outside the allowlist are rejected.
- **SePay webhook**: authenticated via a static API key compared with `crypto.timingSafeEqual`, separate from user JWT auth. Keep `SEPAY_API_KEY` secret — anyone with it can post fake payment confirmations.

## Known gaps / follow-ups not covered by this pass

- `authController.forgotPassword` hardcodes the reset-password URL host (`https://totmartapi.onrender.com/...`) instead of using `FRONTEND_URL` — worth fixing before relying on password reset emails in a different environment.
- Subscription-box cart code (`cartController.js`'s subscribe-cart branches use a field name `subcricePlanId` that doesn't match the `Cart` model's actual `subscriptionPlanId` field) wasn't in scope for this pass and hasn't been fixed — it looks like the same class of bug as the checkout cart-lookup issue that was just fixed, but affecting a different feature.
- No CI workflow runs `npm test` automatically yet.
