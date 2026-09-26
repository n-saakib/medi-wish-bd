# `tests/session.test.ts`

Source: [`tests/session.test.ts`](../../tests/session.test.ts)

## Purpose

Unit coverage for the browser session client in [`src/lib/session.ts`](../src/lib/session.ts.md). It runs in Node with the [`fakeApi`](fakeApi.ts.md) routes as `fetch` and a recording fake Web Lock installed for every test.

## Verification

- **Sign-in:** the identifier payload, `credentials: 'include'`, `no-store` and `redirect: 'error'`, and a result of only the token and user; a failed sign-in keeps only its code and status; a 16 KiB body is read and a larger one rejected; empty, oversized or missing tokens and malformed users are `INVALID_RESPONSE`; concurrent sign-ins run in request order.
- **Restore:** CSRF bootstrap then a credentialed refresh with `X-XSRF-TOKEN` and no Bearer header; `204` restores `null`; `401` rejects as `AUTHENTICATION_REQUIRED`; an error status, failed CSRF bootstrap, missing CSRF token, malformed session or transport failure is rethrown; concurrent restores share one refresh.
- **Lock:** every sign-in, refresh and logout request, CSRF bootstrap included, runs while the shared lock is held; another client's restore waits until a sign-in or refresh body is fully read, or a logout is answered.
- **Authenticated requests:** the Bearer token goes to the API origin and the reader's result is returned; absolute and protocol-relative off-origin paths fail before fetching; a missing token refreshes first; a `204` refresh fails without sending the request; a request still `401` after the first refresh does not refresh again; an expired request is retried once with the new token; a refresh that finds no cookie ends the session without a retry; a retry still `401` ends the session without calling the reader until the next sign-in; concurrent expired requests share one refresh; a newer sign-in survives an older request ending the session; results of other requests and of a response being read are rejected once the session ends.
- **Sign-out:** the logout carries credentials and the CSRF header and the access token is forgotten; an error status or transport failure rejects but still forgets it; a refresh finishing after sign-out is discarded, never used for a retry, and a restore started meanwhile refreshes afresh; a sign-in in flight or queued when sign-out starts is rejected, and a queued one is never sent.
- **Timeouts and storage:** a sign-in, refresh or logout the API never answers is still pending at 9 999 ms and fails with `REQUEST_FAILED` at 10 seconds; no browser storage is touched.

On 2026-09-26 this suite passed as part of `npm run test:unit`.
