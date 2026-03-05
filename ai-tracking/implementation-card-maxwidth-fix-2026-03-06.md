# Implementation Notes - 2026-03-06 - Card Max Width Fix

## Summary
Updated shared `.card` rule in `landing-pages.css` to avoid forcing a fixed max width that constrained account page cards.

## File Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/landing-pages.css`
  - `.card` changed from `max-width: 520px` to `max-width: 100%`

## Validation
- EJS render check passed for `src/views/account.ejs`
