# `tests/adminUsers.test.ts`

Source: [source](<../../tests/adminUsers.test.ts>).

## Purpose

Public client-boundary units for POST body searches, UUID detail requests, exact role/version saves, bounded errors and response projections. Cases reject malformed IDs, roles, MFA states, timestamps, versions, choices, histories and pages. Extra private fields are discarded; deleted actors remain null. A typed recording session adapter supplies synthetic responses.
