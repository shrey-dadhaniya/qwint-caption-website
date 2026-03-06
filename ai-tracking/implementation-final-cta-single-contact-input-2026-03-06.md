# Implementation Notes - 2026-03-06 - Final CTA Single Contact Input

## Summary
Changed home final CTA to a single input where user can enter either email or phone.

## Files Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/index.ejs`
  - Replaced two inputs with one:
    - `id="contactInput"`
    - placeholder: `Enter your email or phone`

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/js/landing.js`
  - Updated `handleDownload()` to:
    - read from `contactInput`
    - detect valid email or valid phone from same value
    - send backend payload as:
      - `email` when input is email
      - `phone` when input is phone
  - Updated validation error placeholder to `Enter valid email or phone`

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/landing.css`
  - Restored single-input CTA layout (flex row + mobile stack)
  - Removed dual-input-only styling usage

## Validation
- `node --check src/server.js`
- EJS render check passed for `src/views/index.ejs`
- JS syntax check passed for `src/public/assets/js/landing.js`
