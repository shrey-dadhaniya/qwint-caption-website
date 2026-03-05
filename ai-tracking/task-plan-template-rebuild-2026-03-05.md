# Task Plan: Template Rebuild (2026-03-05)

- [x] Locate new HTML template in `/template/qwint-caption-landing_page_demo`
- [x] Replace homepage with new template visual structure
- [x] Create production-friendly landing partials (`head`, `navbar`, `footer`)
- [x] Move template assets into versioned public paths (`/assets/css/landing.css`, `/assets/js/landing.js`)
- [x] Add shared subpage stylesheet for non-home routes (`/assets/css/landing-pages.css`)
- [x] Migrate all remaining pages (`privacy`, `terms`, `refund`, `support`, `topup`, `success`, `topup-success`) to landing partials
- [x] Normalize landing navigation/footer anchors to `/#section` across non-home routes
- [x] Ensure landing interactions script is loaded on all migrated pages
- [x] Remove the `Why Qwint` (features) section from landing page
- [x] Rebuild support page UI with dedicated page stylesheet (`/assets/css/support.css`)
- [x] Remove payment logic from landing interactions (UI-only flow)
- [x] Validate EJS and JS syntax
