# Task Plan: Paid Checkout Flow (2026-03-06)

- [x] Update landing pricing section to render from `payment-config.json` packages (`A`, `B`, `C`)
- [x] Add Razorpay popup checkout trigger on package buy button click
- [x] Add backend checkout order creation API
- [x] Add backend payment verification API and redirect to success page
- [x] Add async fulfillment (LiteLLM key generation + plugin zip creation) after payment
- [x] Add success-page polling API for fulfillment status and download URL
- [x] Run syntax/render sanity checks
