# Implementation Notes - 2026-03-06 - Account Width Adjustments

## Summary
Applied layout refinements on `/account`:
- removed top `Account Center` card
- expanded content width for `Available Budget` and `Top Up Credits`
- preserved mobile responsiveness

## Files Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/account.ejs`
  - Removed `<section class="account-hero card">...`

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/account.css`
  - Increased `.account-wrap` max width from `980px` to `1120px`
  - Center-constrained lookup block (`max-width: 760px`) while keeping details/topup full width
  - Ensured `.account-details` and `.account-topup` use full available width
  - Kept responsive breakpoints and removed obsolete hero style blocks

## Validation
- EJS render check passed for `src/views/account.ejs`
