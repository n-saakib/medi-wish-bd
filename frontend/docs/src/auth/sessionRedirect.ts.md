# `src/auth/sessionRedirect.ts`

Source: [`src/auth/sessionRedirect.ts`](../../../src/auth/sessionRedirect.ts)

## Purpose

Decides where a page should send the visitor based on the shared session state. The pages are statically generated and the refresh credential is an HttpOnly cookie on the API origin, so the server cannot know whether a visitor is signed in; redirects run in the browser after the [session provider](SessionProvider.tsx.md) finishes its one restore on load.

## Exports

### `SessionGuard`

`'account'` for pages that need a session and `'guest'` for pages meant only for signed-out visitors (sign-in and registration).

### `sessionRedirect(guard, state): string | null`

Pure function returning the target path, or `null` to stay:

| Situation | `account` guard | `guest` guard |
| --- | --- | --- |
| Restore still running | stay | stay |
| Signed in | stay | `/account` |
| Signing out | stay | — |
| Signed out right after a sign-out (`signedOut` or `signOutError` notice, dropped once the visitor leaves home) | `/` | stay |
| Otherwise signed out | `/sign-in` | stay |

### `useSessionRedirect(guard)`

Hook that computes the target from `useSession()` and calls `router.replace(target)` in an effect whenever the target changes. `replace` is used so the redirected page does not stay in browser history.

## Use cases

- [`AccountSummary`](../account/AccountSummary.tsx.md) uses `account`: a signed-out visitor goes to sign-in, while a visitor who just signed out goes home, where [`SignOutNotice`](SignOutNotice.tsx.md) announces the result. The page does not move while sign-out is pending, so the busy button remains visible.
- [`SignInForm`](SignInForm.tsx.md) and [`RegistrationForm`](RegistrationForm.tsx.md) use `guest`. A successful sign-in, including the one after registration, reaches `/account` through this guard rather than through an explicit navigation in the form.

Redirect targets are fixed paths; no identifier, token or other personal data is placed in a URL.

## Verification

[`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts.md) covers each rule of `sessionRedirect`. The hook's navigation is observed through a mocked router in the sign-in, registration and account tests.
