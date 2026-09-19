# `src/lib/session.ts`

Source: [`src/lib/session.ts`](../../../src/lib/session.ts)

## Purpose

The browser session seam owns short-lived access-token state in module memory. It never persists the access token or exposes the opaque refresh-cookie value to application code.

## Interface

- `createSessionClient(options)` creates an injectable client with an injectable `fetch` dependency.
- `signIn(identifier, password)` posts the fixed login payload with `credentials: include` and validates the `SessionResponse`.
- `restoreSession()` bootstraps CSRF and attempts one refresh, returning `null` for an unauthenticated session.
- `refreshSession()` rotates through the refresh-cookie endpoint and shares one in-flight request among callers.
- `authenticatedFetch(input, init?)` adds the in-memory Bearer token and performs at most one refresh/retry after a `401`.
- `signOut()` sends the CSRF-protected logout request and invalidates memory plus any older in-flight refresh in all outcomes; `clearSession()` is the explicit cleanup seam.

CSRF bootstrapping receives a bounded nonce from `GET /api/auth/csrf`; the API still sets the non-HttpOnly `XSRF-TOKEN` cookie and validates the echoed `X-XSRF-TOKEN` header. Returning the nonce is necessary because the frontend and API use separate origins, so the frontend cannot read an API-origin cookie through `document.cookie`. Responses and errors are bounded before reaching the panel. No localStorage, sessionStorage, IndexedDB, URL, console or durable application state is used for access credentials.

## Verification

`tests/session.test.ts` uses fake fetch responses to cover login, CSRF bootstrap, refresh, single-flight behavior, one retry, logout cleanup including a late-refresh race, malformed responses and storage privacy without a live backend.
