# Implementation Notes - 2026-03-06 - Account Card Width Match

## Summary
Adjusted account layout so `Available Budget` and `Top Up Credits` cards use the same width as the key input card.

## File Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/account.css`
  - `.account-details`:
    - added `max-width: 760px`
    - added `margin: 0 auto`
  - `.account-topup`:
    - added `max-width: 760px`
    - added `margin: 0 auto`

## Validation
- EJS render check passed for `src/views/account.ejs`
