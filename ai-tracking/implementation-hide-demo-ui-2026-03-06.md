# Implementation Notes - 2026-03-06 - Hide Demo UI

## Summary
Temporarily hid demo-related UI on the home page.

## File Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/index.ejs`
  - Removed hero CTA button: `Watch 20s Demo`
  - Hid `See It In Action` section via inline `display:none` on section with `id="demo"`

## Validation
- EJS render check passed for `src/views/index.ejs`
