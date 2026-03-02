### Navigation Link Update
- Updated the "Features" link in the navigation header (both desktop and mobile views in `src/views/partials/navbar.ejs`) to point to `href="/#problem"`. This ensures that when a user clicks the "Features" link, they are correctly scrolled to the "😩 The Problem" section on the home page.
### Meta Pixel Implementation
- Created a new partial at `src/views/partials/meta-pixel.ejs` containing the boilerplate Meta Pixel code.
- Added `<%- include('partials/meta-pixel') %>` immediately before the `</head>` tag across all view files (`index.ejs`, `success.ejs`, `topup.ejs`, `privacy.ejs`, `refund.ejs`, `support.ejs`, `terms.ejs`, `topup-success.ejs`).
- The Meta Pixel initialization expects the `YOUR_PIXEL_ID` string to be replaced with the actual Meta Pixel ID.
