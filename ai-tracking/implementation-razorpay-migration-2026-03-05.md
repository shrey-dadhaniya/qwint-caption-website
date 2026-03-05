# Implementation Log: Razorpay Migration (2026-03-05)

## Architectural Decisions
- Replaced Stripe hosted checkout redirect with Razorpay popup checkout (`checkout.js`) and server-side payment verification.
- Introduced `payment-config.json` at repository root as the single source of truth for:
  - Product catalog and pricing
  - LiteLLM key metadata defaults
  - Per-product budget allocation metadata
- Kept post-payment UX contract unchanged for initial purchase:
  - success page loads immediately
  - polls backend until fulfillment is complete
  - then reveals plugin download button
- Switched fulfillment orchestration from Stripe webhook-driven logic to order verification + async process execution.

## Major Backend Changes
- `src/server.js`
  - Removed Stripe SDK/session/webhook logic.
  - Added Razorpay order creation APIs:
    - `POST /api/checkout`
    - `POST /api/checkout-topup`
  - Added signature verification + capture flow:
    - `POST /api/payment/verify`
  - Added in-memory state tracking for pending orders and fulfillment status.
  - Updated success polling API to use `order_id`:
    - `GET /api/check-key?order_id=...`
  - Updated `/success` rendering to use Razorpay order context.
  - Added Razorpay customer upsert logic during payment verification:
    - ensures `cust_*` customer is created/updated for every successful payment
  - Added LiteLLM key sync to Razorpay customer `notes`:
    - stores `litellm_key` for both initial-buy and top-up
    - stores `plugin_zip_url` for initial-buy
  - Switched customer identity from email-first to phone-first:
    - requires `payment.contact` at verification
    - stores `phone` in LiteLLM metadata
    - uses phone for top-up prefill and success details
  - Hardened Razorpay customer upsert to avoid `400` failures:
    - normalizes phone to digits-only before customer API calls
    - uses `fail_existing: '0'`
    - adds fallback existing-customer lookup from Razorpay list API
    - logs Razorpay error payload for faster diagnosis
- `docker-compose.yml`
  - Replaced Stripe env wiring with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
- `package.json` / `package-lock.json`
  - Removed Stripe dependency.
  - Updated CSP rules for Razorpay checkout domains.

## Frontend Changes
- `src/views/index.ejs`
  - Replaced redirect checkout flow with Razorpay popup flow.
  - Switched product purchase buttons to product IDs from config.
  - Bound pricing display to server-provided product config.
  - Removed forced blank Razorpay prefill override to use provider-default customer detail collection.
- `src/views/topup.ejs`
  - Replaced top-up redirect flow with Razorpay popup flow.
  - Uses LiteLLM key + product ID for top-up order creation.
  - Prefills email when available from key metadata.
- `src/views/success.ejs`
  - Replaced `session_id` polling with `order_id` polling.
  - Kept loader -> ready -> download pattern.

## Content / Policy Updates
- Updated Stripe references to Razorpay in:
  - `src/views/partials/footer.ejs`
  - `src/views/privacy.ejs`
  - `src/views/terms.ejs`
  - `src/views/refund.ejs`
  - `src/views/support.ejs`
  - `src/views/index.ejs`

## Validation
- `node --check src/server.js`
- EJS render checks:
  - `src/views/index.ejs`
  - `src/views/topup.ejs`
  - `src/views/success.ejs`
- JSON parse check:
  - `payment-config.json`
