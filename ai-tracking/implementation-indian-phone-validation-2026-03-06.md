# Implementation Notes - 2026-03-06 - Indian Phone Validation

## Summary
Updated final CTA contact flow so phone numbers are accepted only if they are valid Indian mobile numbers.

## Frontend
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/js/landing.js`
  - Added `normalizeIndianPhone()` and updated `isValidPhone()` to enforce Indian mobile format.
  - `handleDownload()` now treats phone as valid only when Indian validation passes.
  - Validation message updated to: `Enter valid email or Indian phone`.

## Backend
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/server.js`
  - Added `normalizeIndianPhone()` helper.
  - Updated `isValidPhone()` to use Indian phone validation.
  - `POST /api/free-download` now normalizes/validates phone as Indian number only.
  - `upsertRazorpayCustomerByContact()` now requires valid Indian phone input.
  - `findRazorpayCustomerByContact()` updated for Indian-normalized matching.

## Accepted Phone Formats
- `9876543210`
- `09876543210`
- `919876543210`
- `+91 98765 43210`

## Validation
- `node --check src/server.js`
- JS syntax check for `src/public/assets/js/landing.js`
- EJS render check for `src/views/index.ejs`
