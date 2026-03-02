### Content Security Policy (CSP) Updates
- Updated the Helmet Content Security Policy in `src/server.js` to whitelist the required Meta Pixel domains.
- Added `https://connect.facebook.net` to `script-src` so the base Meta Javascript loads without blocking.
- Added `https://www.facebook.com` to `img-src` for the `<noscript>` image pixel fallback.
- Added `https://www.facebook.com` to `connect-src` to allow the Javascript SDK to correctly dispatch tracking events via fetch/XHR network calls.
- Proactively added `'self'`, `data:`, and `https://fonts.gstatic.com` to `font-src` to properly support Google Fonts since `public/assets/css/style.css` imports from it.
### Content Security Policy (CSP) Updates
- Fixed a blocking error caused by Helmet executing strictly regarding inline attributes (`onclick`, `onkeydown`, etc.). Added `"script-src-attr": ["'unsafe-inline'"]` to the `contentSecurityPolicy` directives in `src/server.js` to whitelist inline Javascript event handlers from being blocked.
### Content Security Policy Extended Overrides
- Explicitly added `"style-src-attr": ["'unsafe-inline'"]` to helmet Content Security Policy to prevent modern browsers / helmet defaults from blocking inline `style="..."` tags (which are heavily utilized for structural styling in the UI).
- Double verified that `"script-src-attr": ["'unsafe-inline'"]` is active so all `onclick` forms and button elements process successfully without blocking.
