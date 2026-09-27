# `src/lib/session.ts`

Source: [`src/lib/session.ts`](../../../src/lib/session.ts)

## Purpose

The browser session client. It keeps the short-lived access token in module memory only, and never persists it or sees the HttpOnly refresh cookie. Requests go through the shared [`api.ts`](api.ts.md) boundary, so each one has the 10-second operation timeout and bounded errors.

## Interface

- `createSessionClient({ baseUrl?, fetch? })` creates a client; tests inject `fetch`. The module also exports one default client's `signIn`, `restoreSession`, `authenticatedFetch`, `startMfaEnrollment`, `verifyMfaEnrollment`, `verifyMfa` and `signOut`, and the types `MfaStatus`, `RestoredSession`, `MfaEnrollment` and `EnrolledSession`.
- `signIn(identifier, password)` posts `{ identifier, password }` with `credentials: 'include'` and returns `{ accessToken, user, mfa }`. `mfa` must be `NOT_REQUIRED`, `ENROLLMENT_REQUIRED`, `VERIFICATION_REQUIRED` or `VERIFIED`, otherwise the response is `INVALID_RESPONSE`. Other response fields are ignored.
- `restoreSession()` fetches a CSRF token and calls refresh once. It returns `{ user, mfa }` when the cookie is accepted and `null` for a `204` (no refresh cookie). A `401` (expired or revoked cookie) and every other failure are rethrown as `ApiError`.
- `authenticatedFetch(path, init, readResponse)` resolves `path` against the API base URL and rejects any other origin before fetching. Without an in-memory token it refreshes first. It sends the Bearer token and returns what `readResponse` returns. A `401` is refreshed and retried once. A `401` after that single refresh drops the token and rejects with `AUTHENTICATION_REQUIRED` (`401`) without calling the reader.
- `startMfaEnrollment()` posts `{}` to `/api/auth/mfa/enrollment` through `authenticatedFetch` and requires `201`. It returns `{ enrollmentId, secret, otpauthUri, expiresIn }`: a UUID, a 32-character base32 key, an `otpauth://totp/` URI of at most 512 characters and a whole number of seconds from 1 to 86400. Anything else is `INVALID_RESPONSE`.
- `verifyMfaEnrollment(enrollmentId, code)` posts to `/api/auth/mfa/enrollment/verify` and `verifyMfa(code)` to `/api/auth/mfa/verify`. Both send the restricted access token as Bearer with `credentials: 'include'`, because on success the API revokes that session and sets a new refresh cookie. They refresh first when no token is held, hold the cookie-mutation lock for the exchange, and store the new access token. `verifyMfaEnrollment` also returns exactly ten backup codes in the form `XXXX-XXXX` (capital letters and digits), otherwise `INVALID_RESPONSE`. A `401` drops the token that was used; error codes such as `MFA_CODE_INVALID`, `MFA_ENROLLMENT_STALE` and `TOO_MANY_ATTEMPTS` are rethrown unchanged. The client never keeps the key or the codes.
- `signOut()` ends the in-memory session at once, then posts the CSRF-protected logout. A non-2xx response or transport failure rejects, but the local session has already ended.
- `projectSessionUser(body)` validates and projects `username` (≤ 50), `mobile` (≤ 30), `email` (≤ 320 or `null`) and `mobileVerified`. Tokens are limited to 4096 characters.

## Concurrency

- **One refresh at a time.** Concurrent callers share one in-flight refresh.
- **Cookie-mutation lock.** Sign-in, refresh and logout hold one exclusive same-origin Web Lock (`medi-wish:auth-cookie-mutation`) from the CSRF request until the response is fully read, so tabs never apply refresh-cookie rotations out of order. Web Locks exist only in a secure context (HTTPS or loopback). Without them, for example over plain HTTP at a LAN address, the same operations queue on one module-level promise chain, so they are serialized within the tab but not across tabs (Ticket 03.03 D4). A failed operation does not block the queue. Hosted environments always use HTTPS.
- **Stale results.** A session epoch makes results of requests that used a dropped token fail with `AUTHENTICATION_REQUIRED`. A cookie-mutation epoch does the same for sign-ins and refreshes still queued or in flight when sign-out starts, so none can revive a signed-out client. A request that ends the session advances only the session epoch, so a newer sign-in is kept. An MFA verification is checked the same way: it fails with `AUTHENTICATION_REQUIRED` when a sign-out started or the token changed while it waited for the lock, and on success it advances the session epoch, so requests that used the restricted token become stale.

The CSRF token comes from `GET /api/auth/csrf` and is echoed as `X-XSRF-TOKEN`; the frontend and API are separate origins, so the page cannot read the API's cookie. No access credential is written to storage, URLs or logs.

## Verification

[`tests/session.test.ts`](../../tests/session.test.ts.md) covers each operation, restore `204`/`401`/other failures, refreshing before a request without a token, the single retry, the lock and its in-tab fallback, stale-result guards around sign-out, the MFA status on sign-in and restore, enrollment start and verification (bounds, Bearer and cookie use, token replacement, error codes, the lock and a verify queued behind sign-out), the timeouts and storage privacy, without a live backend.
