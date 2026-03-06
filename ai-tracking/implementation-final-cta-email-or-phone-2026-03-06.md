# Implementation Notes - 2026-03-06 - Final CTA Email or Phone

## Summary
Updated the home page final CTA so users can provide either email or phone (any one) for free download.

## Frontend Changes
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/index.ejs`
  - Final CTA form now has:
    - `#emailInput` (optional)
    - `#phoneInput` (optional)
    - `or` separator

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/landing.css`
  - `.final-email-capture` switched to grid layout to support two inputs + button
  - added `.capture-or` styling
  - responsive rules updated for mobile stacking

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/js/landing.js`
  - Added phone normalization/validation helpers
  - `handleDownload()` now accepts valid email OR valid phone
  - If both invalid/missing, shows field-level validation
  - Sends only valid fields to backend

## Backend Changes
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/server.js`
  - Added `isValidPhone()`
  - Added `upsertRazorpayCustomerByContact()`
  - Updated `createFreeLiteLlmKey()` to include optional `phone`
  - Updated `POST /api/free-download` to accept:
    - valid email OR valid phone
    - creates Razorpay customer using available identifier
    - stores provided contact data in Razorpay notes and key metadata

## Validation
- `node --check src/server.js`
- EJS render check for `src/views/index.ejs`
- JS syntax check for `src/public/assets/js/landing.js`
