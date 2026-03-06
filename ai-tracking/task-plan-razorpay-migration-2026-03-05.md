# Task Plan: Razorpay Migration (2026-03-05)

- [x] Verify `/ai-tracking/config.json` allows command execution
- [x] Audit Stripe backend/frontend integration points
- [x] Add root `payment-config.json` for products + LiteLLM budget metadata
- [x] Replace Stripe checkout session flow with Razorpay popup order flow
- [x] Add payment verification endpoint and async fulfillment pipeline
- [x] Keep success-page polling loader and download behavior
- [x] Update copy/legal/support references from Stripe to Razorpay
- [x] Run syntax/template validation checks
