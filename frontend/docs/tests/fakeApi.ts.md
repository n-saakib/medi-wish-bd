# `tests/fakeApi.ts`

Source: [`tests/fakeApi.ts`](../../tests/fakeApi.ts)

## Purpose

Shared fakes for the unit and mounted tests, so each suite describes only the API answers it cares about. It is not a test file itself (it does not match `*.test.ts`), so Vitest loads it only through imports.

## Exports

- `signedInUser` and `sessionBody(accessToken?)` — the synthetic user and the body the API returns for a sign-in or refresh.
- `apiRoutes(routes)` — a fake `fetch` that answers each API path from its route, builds a real `Request` for every call and records it (`requests`, and `paths()` for their pathnames). `GET /api/auth/csrf` answers `{ csrfToken: 'csrf' }` unless overridden; an unrouted path fails the request.
- `stalledRoute` — a route that never answers and rejects once the request is aborted, for the operation-timeout tests.
- `deferred()` — a promise with external `resolve`/`reject`, used to hold a request or response open mid-test.
- `flushTasks()` — waits one macrotask so every pending promise callback runs.
- `installFakeLocks()` — shadows `navigator.locks` (jsdom has none) with a recording exclusive lock that grants requests in order; `names`, `held()` and `restore()` let a test check the lock name, whether a request ran inside it, and put the original back.

## Use cases

Used by `session.test.ts`, `user.test.ts`, `SessionProvider.test.ts`, `SignInForm.test.ts`, `RegistrationForm.test.ts`, `SiteHeader.test.ts`, `AccountSummary.test.ts` and [`renderWithSession`](renderWithSession.ts.md). Mounted tests pass `apiRoutes(...).fetch` to a real `createSessionClient`, so their sessions expire and restore through the same code as the browser.

## Verification

Exercised by those suites; on 2026-09-26 `npm run verify` passed over this file.
