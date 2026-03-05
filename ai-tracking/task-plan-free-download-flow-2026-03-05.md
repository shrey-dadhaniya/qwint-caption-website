# Task Plan: Free Download Flow (2026-03-05)

- [x] Reduce `payment-config.json` to only required free-flow config
- [x] Add backend API for free download (`/api/free-download`)
- [x] Create LiteLLM key with free credits and metadata (email + customer id)
- [x] Upsert Razorpay customer by email and store key in customer notes
- [x] Generate plugin zip with key replacement and return download URL
- [x] Wire homepage download CTA to call backend and start zip download
- [x] Run syntax and render checks
