# Implementation Log: Template Rebuild (2026-03-05)

## Scope
- Replaced the existing homepage with the new template from `/template/qwint-caption-landing_page_demo`.
- Focused only on UI and styling; payment flow is intentionally disabled on this page.

## Structural Changes
- Added landing partials:
  - `src/views/partials/landing/head.ejs`
  - `src/views/partials/landing/navbar.ejs`
  - `src/views/partials/landing/footer.ejs`
- Updated `src/views/index.ejs` to consume these partials.
- Migrated remaining pages to landing partials and shared design system:
  - `src/views/privacy.ejs`
  - `src/views/terms.ejs`
  - `src/views/refund.ejs`
  - `src/views/support.ejs`
  - `src/views/topup.ejs`
  - `src/views/success.ejs`
  - `src/views/topup-success.ejs`
- Updated landing partial links for cross-page correctness:
  - `src/views/partials/landing/navbar.ejs`
  - `src/views/partials/landing/footer.ejs`
- Removed landing features block (`Why Qwint`) from homepage:
  - `src/views/index.ejs`

## Asset Changes
- Added new dedicated landing assets:
  - `src/public/assets/css/landing.css` (copied from new template)
  - `src/public/assets/js/landing.js` (rewritten for UI-only behavior)
- Added shared subpage stylesheet:
  - `src/public/assets/css/landing-pages.css`
- Added dedicated support page stylesheet:
  - `src/public/assets/css/support.css`

## Behavior Changes (UI-only)
- Removed payment-specific execution from landing JS.
- Pricing CTA buttons now route users to the final CTA section (`handlePricingCta`) instead of opening payment.
- Preserved UX animations/interactions:
  - sticky nav state
  - mobile menu toggle
  - caption cycling
  - generate button mock animation
  - FAQ accordion
  - intersection reveal
- Enabled landing navigation behavior (hamburger/menu state) consistently on non-home pages by loading `/assets/js/landing.js`.
- Standardized anchor URLs to `/#...` in landing navbar/footer to avoid broken in-page links from subroutes.
- Updated support page to use dedicated stylesheet and rewritten page-level class structure for a full visual refresh (instead of generic shared subpage styles).
- Updated support layout to single-column full-width sections for both `Common Issues & Solutions` and `Contact Support`.
- Fixed support consent row alignment by overriding checkbox sizing/flex behavior to avoid inherited full-width input styles.

## Validation
- Render check: `src/views/index.ejs` (EJS compile success)
- Syntax check: `src/public/assets/js/landing.js` (node check success)
- Confirmed no remaining references to old local template paths (`style.css`, `script.js`) in the homepage.
- Render checks passed for all migrated pages:
  - `privacy.ejs`
  - `terms.ejs`
  - `refund.ejs`
  - `support.ejs`
  - `topup.ejs`
  - `success.ejs`
  - `topup-success.ejs`
