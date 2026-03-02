### Refactoring & Header Updates
- Created two reusable EJS components: `src/views/partials/navbar.ejs` and `src/views/partials/footer.ejs` to prevent code duplication, streamline updates, and make the app more uniform. 
- Integrated these new partials into every page (`index.ejs`, `privacy.ejs`, `refund.ejs`, `support.ejs`, `terms.ejs`, `success.ejs`, `topup.ejs`, `topup-success.ejs`).
- Removed the "Login" button and its associated modal overlay (along with all its styling) across the application.
- Added a "⚡ Top-up" button to the unified navbar that directs users to the `/topup` page to query their account and manage their credits directly. 
- Refactored `success.ejs` to use `window.pluginKey` for managing access to the billing portal, accommodating the removal of the old UI elements.
- Centralized `toast` CSS logic to `src/public/assets/css/style.css` so toast notifications work smoothly globally. 
