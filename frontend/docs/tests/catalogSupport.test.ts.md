# `tests/catalogSupport.test.ts`

Source: [`../../tests/catalogSupport.test.ts`](../../tests/catalogSupport.test.ts)

## Purpose

Unit coverage for two Ticket 14 browser-test helpers in [`tests/browser/catalogSupport.ts`](browser/catalogSupport.ts.md) whose failure would break many specs at once: the access-token renewal every API actor uses, and the cleanup of `staffContext`. It lives outside `tests/browser/` so Playwright does not collect it. The refresh call and the clock are fakes the test settles and moves by hand, so no API, browser or timer runs; `support.ts` is mocked.

## Verification

- `TokenRenewal` keeps the token at exactly 60% of its 10-second lifetime and renews it once just after; the renewed token is not renewed again until it ages past 60%.
- Three concurrent calls on an old token start one refresh and all get the new token, so the refresh cookie is never replayed; a later call reuses it, and the next expiry starts a second refresh.
- A failed refresh rejects every call waiting on it with the same error; the next call starts a new refresh instead of reusing the failed one.
- `staffContext` closes its browser context and rethrows when the staff sign-in or enrollment fails, and leaves the context open for the caller when it succeeds.

On 2026-10-04 `npx vitest run --project unit tests/testApi.test.ts tests/catalogSupport.test.ts` passed (2 files, 47 tests: 42 and 5).
