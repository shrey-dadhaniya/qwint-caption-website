# Implementation - Webhook + Restart Recovery (2026-03-06)

## Summary
- Added persistent runtime state for payment/order lifecycle.
- Added secure Razorpay webhook endpoint and shared fulfillment pipeline.
- Added restart recovery so payment confirmation keeps working after server restarts.
- Hardened Razorpay customer upsert and notes strategy.

## Backend Changes
- `src/server.js`
  - Added runtime state storage:
    - `src/private/runtime/payment-state.json`
    - persisted maps/sets: `pendingOrders`, `fulfillmentByOrder`, `processedPaymentIds`
    - load on startup + periodic cleanup persistence
  - Added helpers:
    - order/payment/customer fetch and recovery from Razorpay
    - captured payment resolution
    - idempotent fulfillment queueing for paid checkout and account top-up
    - ready-state restoration from Razorpay customer notes + LiteLLM metadata
  - Added webhook route:
    - `POST /api/webhooks/razorpay`
    - raw-body signature verification using `RAZORPAY_WEBHOOK_SECRET`
    - handles `payment.captured`, `payment.authorized`, `order.paid`
  - Updated verify/status endpoints to use unified queue/recovery logic:
    - `/api/payment/verify`
    - `/api/check-key`
    - `/api/account/payment/verify`
    - `/api/account/payment-status`
  - Customer note behavior:
    - keeps `litellm_key` and `plugin_zip_url` for paid/download flows
    - top-up flow stores `litellm_key` early when available
  - Added process signal hooks to flush runtime state.

## Frontend Changes
- `src/public/assets/js/account.js`
  - Sends `topup_key` in `/api/account/payment/verify`.
  - Sends `x-topup-key` header in `/api/account/payment-status` polling.

## Config/Infra Changes
- `.env.example`
- `example.env`
  - added `RAZORPAY_WEBHOOK_SECRET`
- `docker-compose.yml`
  - added `RAZORPAY_WEBHOOK_SECRET` env wiring
  - added `payment_runtime` named volume mounted at `/app/src/private/runtime`
- `.gitignore`
  - ignored `src/private/runtime/`

## Validation
- `node --check src/server.js` passed.
- `node --check src/public/assets/js/account.js` passed.
