# Implementation Notes - 2026-03-06 - Hero Video Integration

## Summary
Replaced the home hero visual mockup with a real product demo video using:
- `/assets/videos/qwint-caption-demo.mp4`

## Files Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/views/index.ejs`
  - Replaced old hero mockup markup with:
    - `.hero-video-shell`
    - `<video class="hero-video" autoplay muted loop playsinline preload="metadata" controls>`

- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/public/assets/css/landing.css`
  - Added styles:
    - `.hero-video-shell`
    - `.hero-video`
  - Updated mobile media rule so `.hero-visual` is visible (instead of hidden)

## Validation
- EJS render check passed for `src/views/index.ejs`
- JS syntax check passed for `src/public/assets/js/landing.js`
