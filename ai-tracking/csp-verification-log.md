# CSP Verification Log: 2026-03-05

## Task
Verify all `.ejs` and `.js` files to ensure no third-party endpoints or CDNs were missed in the newly updated Content Security Policy (via helmet in `server.js`).

## Findings
- **Scripts:** 
  - `assets/js/script.js` -> covered by `'self'`
  - `https://connect.facebook.net` -> covered explicitly
  - `https://www.googletagmanager.com` -> covered explicitly
  - `https://www.clarity.ms` -> covered explicitly
  - Inline scripts (`<script>...</script>`) -> covered by `'unsafe-inline'`
- **Links/Styles:**
  - `assets/css/style.css` -> covered by `'self'`
  - `https://fonts.googleapis.com` -> covered explicitly 
  - Inline styles (`style="..."`) -> covered by `'unsafe-inline'` mapped to `style-src-attr`
- **Images:**
  - Local `/assets/icons/...`, `/assets/images/...` -> covered by `'self'`
  - Meta pixel `https://www.facebook.com/tr...` -> covered explicitly 
  - Stripe images -> covered explicitly (`images.stripe.com`)
  - Clarity pixels -> covered explicitly (`*.clarity.ms`)
- **Fonts:**
  - Local fonts -> covered by `'self'`
  - Google Fonts -> covered explicitly (`fonts.gstatic.com`)
- **Media:**
  - Local demo video `assets/videos/qwint-caption-demo.mp4` -> correctly covered by `default-src: "'self'"`
- **Connections/Fetch:**
  - GA & GTM -> covered explicitly (`*.google-analytics.com`, `*.analytics.google.com`)
  - Facebook pixel API -> covered explicitly (`www.facebook.com`)
  - Clarity sync endpoints -> covered explicitly (`*.clarity.ms`)
  - Local API (/api/checkout) -> covered by `'self'`

## Conclusion
The current `helmet` CSP rules in `server.js` correctly whitelist all 100% of the external resources and local assets used across the EJS templates. No missing domains were found.
