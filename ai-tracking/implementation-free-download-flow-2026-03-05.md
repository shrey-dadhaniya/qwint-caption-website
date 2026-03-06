# Implementation Log: Free Download Flow (2026-03-05)

## Scope
- Implement first-user flow from homepage download section:
  - user enters email
  - backend creates free LiteLLM key
  - backend creates plugin zip
  - zip download starts immediately
- Integrate Razorpay customer creation and metadata linking for this free flow.
- Trim `payment-config.json` to required data only.

## Config Changes
- Replaced `payment-config.json` with minimal schema:
  - `free_download`
    - `team_id`
    - `models`
    - `key_type`
    - `key_budget`
    - `metadata_available_budget`
    - `metadata_customer_id_field`
    - `metadata` (static metadata defaults)
  - `plugin`
    - `template_zip_path`
    - `key_placeholder`

## Backend Changes
- Updated `src/server.js`:
  - Added LiteLLM and Razorpay axios clients.
  - Added email validation and Razorpay customer upsert-by-email logic.
  - Added LiteLLM free key creation logic:
    - key budget from `free_download.key_budget`
    - `available_budget` metadata from `free_download.metadata_available_budget`
    - includes email in key metadata
    - includes Razorpay customer id in key metadata (`metadata_customer_id_field`)
  - Added plugin zip generation logic using `fflate` and configured placeholder replacement.
  - Added API endpoint:
    - `POST /api/free-download`
    - returns `{ ok: true, downloadUrl }`
  - Removed all other API endpoints; only free download API remains.

## Frontend Changes
- Updated `src/public/assets/js/landing.js`:
  - `handleDownload()` now calls `POST /api/free-download` with email.
  - On success, programmatically starts zip download from returned URL.
  - Added inline button loading state + toast error/success handling.

## Validation
- `node --check src/server.js` passed
- `node --check src/public/assets/js/landing.js` passed
- EJS render checks passed for:
  - `index.ejs`
  - `topup.ejs`

## Notes
- `.env` was not read or modified.
- Ensure these env vars are set for runtime:
  - `LITELLM_URL`
  - `LITELLM_MASTER_KEY`
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
