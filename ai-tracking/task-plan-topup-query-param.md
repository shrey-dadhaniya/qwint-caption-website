# Task: Handle Query Parameter in Topup Page

## Objective
Automatically lookup account details in the topup page if a `key` query parameter is present in the URL, and clean up the URL afterwards.

## Steps
- [x] Research: Confirm the query parameter name and expected behavior.
- [x] Implementation: Update `src/views/topup.ejs` to check for `key` param on load.
- [x] Implementation: Update `src/views/topup.ejs` to remove the `key` param from URL using `replaceState`.
- [x] Verification: Test the functionality (simulated).

## Implementation Details
- Add an `DOMContentLoaded` event listener or a script block at the end of the body.
- Use `URLSearchParams` to extract the `key`.
- Populate the input field and trigger `lookupCustomer()`.
- Use `history.replaceState` to clean the URL.
