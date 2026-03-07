# Implementation Notes - 2026-03-06 - Account Status Endpoint Fix

## Summary
Fixed account payment status endpoint behavior to avoid surfacing an error when order ids belong to non-account flows.

## File Updated
- `/Users/shrey/Dev/clients/qwint/qwint-caption-website/src/server.js`
  - In `GET /api/account/payment-status`:
    - changed non-account flow response from:
      - `400 { status: "error", message: "Order is not an account top-up order" }`
    - to:
      - `200 { status: "processing" }`

## Why
This prevents user-facing flow breakage/noise if a non-account order id is checked by account polling logic.

## Validation
- `node --check src/server.js`
