# `tests/session.integration.test.ts`

Source: [`../../tests/session.integration.test.ts`](../../tests/session.integration.test.ts)

## Purpose

Checks the frontend's own registration and session clients against the running backend: a Customer's password sign-in carries the MFA status the browser routes on.

## Case covered

The `story 06` test reads `MEDI_WISH_API_URL` and fails with a setup message when it is missing. It then:

1. registers a synthetic Customer (`integration.<hex>`, a random `018` mobile, no email) with `registerUser`;
2. signs in by username with a real `createSessionClient`.

It requires `mfa` to be `NOT_REQUIRED`, and the projected user to carry the username, mobile and a `null` email. It adds one synthetic User to the test database; run it only against a test backend.

## Verification

Run it with `npm run test:integration` against the test API, as described on the [test API page](browser/testApi.ts.md). On 2026-09-27 it passed there.
