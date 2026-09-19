# `tests/session.test.ts`

Source: [`tests/session.test.ts`](../../tests/session.test.ts)

## Purpose

Deterministic unit coverage for the browser session seam using injected fetch and cookie-reader fakes.

## Verification

The suite covers the fixed login payload, credentialed CSRF/refresh/logout requests, `X-XSRF-TOKEN` construction, memory-only access state, concurrent single-flight refresh, one 401 retry without loops, absent-session restore, logout cleanup after a late refresh, malformed session responses and the absence of browser-storage calls.
