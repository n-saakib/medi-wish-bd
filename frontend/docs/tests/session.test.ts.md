# `tests/session.test.ts`

Source: [`tests/session.test.ts`](../../tests/session.test.ts)

## Purpose

Deterministic unit coverage for the browser session seam using an injected fetch fake.

## Verification

The suite covers the fixed login payload, positive-integer `expiresIn` values above one day and rejection of zero, negative or fractional values, acceptance of a valid JSON body exactly at the 16 KiB byte limit, credentialed CSRF/refresh/logout requests, `X-XSRF-TOKEN` construction, memory-only access state, concurrent same-client single-flight refresh, and independent clients sharing one same-origin exclusive Web Lock for sign-in, refresh, and logout. The cross-client regression holds sign-in and refresh response parsing and the logout response open while a sibling mutation queues, and asserts that CSRF bootstrap and every cookie-mutating request remain inside the lock. It also covers concurrent expired authenticated requests sharing one in-flight refresh with exactly one retry per request, serialized concurrent sign-ins, one 401 retry without loops including replay of a body-bearing `Request`, pre-aborted and in-flight caller cancellation, prompt cancellation while awaiting a shared refresh without canceling that refresh, cancellation before retry dispatch, preservation of the native `Response` when no reader is passed, clearing a token rejected by that retry, rejection of an in-flight protected response after a separate refresh fails, stale-result invalidation, successful later sign-in, preservation of a sign-in queued during the retry, rejection of stale retries after session invalidation during refresh, zero-fetch rejection for off-origin string/URL/Request destinations, revalidation of a mutable URL before retry, delayed sign-in invalidation, absent-session restore, logout cleanup after a late refresh, and malformed projected session responses. A signed-in logout whose transport fails also verifies `isAuthenticated()` is cleared and a later authenticated request is rejected before the fetch boundary is called. The suite continues to assert the absence of browser-storage calls.
