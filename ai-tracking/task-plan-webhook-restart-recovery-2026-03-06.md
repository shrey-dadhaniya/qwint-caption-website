# Task Plan - Webhook + Restart Recovery (2026-03-06)

- [x] Audit current Razorpay verify + fulfillment flow and identify restart gaps.
- [x] Persist payment/order state (`pendingOrders`, fulfillment state, processed ids) to disk.
- [x] Add Razorpay webhook endpoint with signature verification.
- [x] Unify fulfillment entry path so verify/webhook/status polling all reuse same processing logic.
- [x] Add restart recovery logic to rebuild context from Razorpay order/payment and continue processing.
- [x] Ensure customer notes carry LiteLLM key + zip URL where applicable.
- [x] Update account client polling/verify payload with key hints for robust top-up recovery.
- [x] Update example env + docker compose for webhook secret/runtime persistence.
