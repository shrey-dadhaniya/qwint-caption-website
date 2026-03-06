# Implementation Notes - 2026-03-06 - Account Flow

## Summary
Implemented a new account management flow centered on a user-supplied LiteLLM key:
- New `/account` route + new account template/UI
- Key lookup + budget display from LiteLLM key metadata
- Plugin zip regeneration from key
- In-page Razorpay top-up flow (no redirect)
- Async credit update polling and UI loader

## Backend Changes
- Updated `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/server.js`
  - Added LiteLLM key-info helper functions:
    - `ensureLiteLlmConfigured`
    - `getMetadataCustomerIdField`
    - `getOrderContextCustomerId`
    - `toLiteLlmInfoPayload`
    - `getLiteLlmKeyInfo`
  - Extended Razorpay order creation:
    - `createRazorpayOrderForProduct(productId, options)`
    - supports per-flow notes/context (`paid_checkout`, `account_topup`)
  - Added account top-up fulfillment:
    - `processAccountTopupFulfillment`
    - updates existing key `metadata.available_budget`
    - updates key customer metadata (`razorpay_customer_id` + configured customer-id field)
    - updates Razorpay customer notes with `litellm_key`
  - Added account APIs:
    - `POST /api/account/key-info`
    - `POST /api/account/download-zip`
    - `POST /api/account/checkout`
    - `POST /api/account/payment/verify`
    - `GET /api/account/payment-status`
  - Added `/account` page route and redirected `/topup` to `/account`
  - Guarded generic `/api/payment/verify` from account-topup orders
  - Updated Razorpay customer upsert to store flow-specific `flow_type`

## Frontend Changes
- Added `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/account.ejs`
  - Key input + load button
  - Account details section with available budget
  - Download zip action
  - Top-up cards rendered from config-driven products
  - Razorpay checkout script integration
- Added `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/js/account.js`
  - Key lookup flow
  - Zip download flow
  - Top-up checkout flow
  - Payment verify + polling flow
  - Credit loading indicator handling
- Added `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/account.css`
  - Account page layout and component styling
- Updated shared head partial:
  - `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/partials/landing/head.ejs`
  - supports optional `extraCssPaths` list
- Updated landing navbar:
  - `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/partials/landing/navbar.ejs`
  - added `Account` link

## Validation
- `node --check src/server.js`
- EJS render checks for:
  - `src/views/index.ejs`
  - `src/views/account.ejs`
- JS syntax check for:
  - `src/public/assets/js/account.js`
