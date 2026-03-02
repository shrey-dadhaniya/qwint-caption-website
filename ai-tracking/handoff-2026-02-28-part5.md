### Topup Validation Update
- Updated `/api/topup-info` route to exclusively accept LiteLLM keys for account queries. Removed the prior logic that allowed users to look up their Stripe customers via email.
- Adjusted the UI placeholders and hint texts in `src/views/topup.ejs` to prompt users specifically for their "LiteLLM key" and removed "email" from the copy and validation toasts.

### Topup Credit Balance UI Update
- Fixed the UI on `src/views/topup.ejs` to correctly show the balance as "AI Credits: X mins" instead of "Balance: ₹X" since the available budget tracks minutes, not currency.
