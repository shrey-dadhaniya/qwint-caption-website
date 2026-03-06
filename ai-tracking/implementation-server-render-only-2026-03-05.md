# Implementation Log: Server Render-Only Simplification (2026-03-05)

## Scope
- User requested a backup of `server.js` and removal of all payment/API logic from the active server.

## Changes
- Created backup:
  - `src/server.backup-2026-03-05.js`
- Replaced active server:
  - `src/server.js`
- Forced production-only runtime behavior in active server:
  - sets `process.env.NODE_ENV = 'production'`
  - uses production CSP path always
  - uses `morgan('combined')` always
  - logs `Mode: PRODUCTION` without dev branching

## What The New `server.js` Keeps
- Environment loading (`dotenv`)
- Express app setup
- EJS view engine + views path
- Static asset serving (`src/public`)
- Helmet middleware
- Compression + request logging
- Page rendering routes:
  - `/`
  - `/privacy`
  - `/refund`
  - `/support`
  - `/terms`
  - `/topup`
  - `/topup-success`
  - `/success`
  - `/health`

## What Was Removed
- Razorpay client + all Razorpay order/payment/customer helpers
- LiteLLM client + key generation/update calls
- All `/api/*` endpoints and payment verification flows
- In-memory fulfillment/order state maps and related polling logic
- Plugin zip generation pipeline
- Billing portal API stubs

## Compatibility Notes
- Top-up and success pages still render with fallback data for template compatibility.
- Frontend scripts on those pages may still attempt to call removed APIs, which now return 404 by design after this change.

## Validation
- `node --check src/server.js` passed
- EJS render checks passed for:
  - `topup.ejs`
  - `success.ejs`
