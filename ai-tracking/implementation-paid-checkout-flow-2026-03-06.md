# Implementation Log: Paid Checkout Flow (2026-03-06)

## Scope
- Implemented paid package flow from landing pricing cards:
  - popup checkout
  - payment verification
  - redirect to success page
  - success-page loader until backend key+zip fulfillment completes
  - final download button

## Frontend Changes
- `src/views/index.ejs`
  - Pricing section now renders dynamically from `products` config data.
  - Buy button now calls `handlePackageCheckout('<productId>')`.
  - Added Razorpay checkout script: `https://checkout.razorpay.com/v1/checkout.js`.
- `src/public/assets/js/landing.js`
  - Added checkout functions:
    - `handlePackageCheckout(productId)`
    - `openRazorpayCheckout(...)`
    - `verifyPaymentAndRedirect(...)`
  - Added request flow:
    - `POST /api/checkout`
    - Razorpay popup
    - `POST /api/payment/verify`
    - redirect to `/success?...`
- `src/views/success.ejs`
  - Kept loader/poll/download pattern.
  - Updated secondary CTA from `/topup` to `/#pricing`.

## Backend Changes
- `src/server.js`
  - Added in-memory checkout/fulfillment state maps:
    - `pendingOrders`
    - `fulfillmentByOrder`
    - `processedPaymentIds`
  - Added product lookup + per-package LiteLLM plan resolution from config.
  - Added payment endpoints:
    - `POST /api/checkout` -> creates Razorpay order for selected package
    - `POST /api/payment/verify` -> verifies signature, captures payment if needed, upserts Razorpay customer, starts fulfillment
    - `GET /api/check-key` -> returns `processing|ready|error` status for success page polling
  - Added paid fulfillment pipeline:
    - create LiteLLM key using selected package limits/details from config
    - attach customer id in LiteLLM metadata
    - create plugin zip with generated key
    - store LiteLLM key + zip URL in Razorpay customer notes
  - Updated CSP to allow Razorpay checkout script/frame/connect domains.
  - Kept existing free-download API flow intact.

## Config Compatibility
- Uses `payment-config.json` package fields (`products`) for pricing and fulfillment.
- Supports package `benefits` by mapping to internal `includes`.
- Reads payment gateway metadata from `payment_gateway`.
- Reads customer metadata field + defaults from `litellm_key_details`.

## Validation
- `node --check src/server.js` passed
- `node --check src/public/assets/js/landing.js` passed
- EJS render checks passed:
  - `index.ejs`
  - `success.ejs`
