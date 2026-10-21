# `src/auth/sessionRedirect.ts`

Source: [`src/auth/sessionRedirect.ts`](../../../src/auth/sessionRedirect.ts)

## Purpose

Decides where a page should send the visitor based on the shared session state. The pages are statically generated and the refresh credential is an HttpOnly cookie on the API origin, so the server cannot know whether a visitor is signed in; redirects run in the browser after the [session provider](SessionProvider.tsx.md) finishes its one restore on load.

## Exports

### `SessionGuard`

`'guest'` for pages meant only for signed-out visitors (sign-in and registration), `'account'` for `/account`, `'mfa-enrollment'` for `/staff/mfa/enroll`, `'mfa-challenge'` for `/staff/mfa` and `'staff'` for `/staff`.

### `sessionRedirect(guard, state): string | null`

Pure function returning the target path, or `null` to stay. Every guard stays while the restore is running.

A signed-in session has one home page chosen by its MFA status: `NOT_REQUIRED` → `/account`, `ENROLLMENT_REQUIRED` → `/staff/mfa/enroll`, `VERIFICATION_REQUIRED` → `/staff/mfa`, `VERIFIED` → `/staff`. Each guard admits some statuses and sends every other status to its home page:

| Session MFA status | `guest` | `account` | `mfa-enrollment` | `mfa-challenge` | `staff` |
| --- | --- | --- | --- | --- | --- |
| `NOT_REQUIRED` | `/account` | stay | `/account` | `/account` | `/account` |
| `ENROLLMENT_REQUIRED` | `/staff/mfa/enroll` | `/staff/mfa/enroll` | stay | `/staff/mfa/enroll` | `/staff/mfa/enroll` |
| `VERIFICATION_REQUIRED` | `/staff/mfa` | `/staff/mfa` | `/staff/mfa` | stay | `/staff/mfa` |
| `VERIFIED` | `/staff` | stay | `/staff` | `/staff` | stay |
| Signed out | stay | see below | `/sign-in` | `/sign-in` | `/sign-in` |

A restricted staff session therefore cannot reach `/account` or `/staff` until it is verified, and a verified staff member may still open `/account`. While a sign-out is pending, the `account` and staff guards both stay put, so the busy button remains visible. For a signed-out visitor the `account` guard keeps its earlier rules: goes to `/` right after a sign-out (`signedOut` or `signOutError` notice, dropped once the visitor leaves home) and otherwise to `/sign-in`.

### `useSessionRedirect(guard, { enabled = true })`

Hook that computes the target from `useSession()` and calls `router.replace(target)` in an effect whenever the target changes. With `enabled: false` it holds the redirect: setup passes it while a code is being verified and while the backup codes are shown, so the status turning `VERIFIED` does not move the page before the codes are saved. `replace` is used so the redirected page does not stay in browser history.

## Use cases

- [`AccountSummary`](../account/AccountSummary.tsx.md) uses `account`: a signed-out visitor goes to sign-in, while a visitor who just signed out goes home, where [`SignOutNotice`](SignOutNotice.tsx.md) announces the result. The page does not move while sign-out is pending, so the busy button remains visible.
- [`SignInForm`](SignInForm.tsx.md) and [`RegistrationForm`](RegistrationForm.tsx.md) use `guest`. A successful sign-in, including the one after registration, reaches the session's home page (`/account`, or a staff MFA page for Admin and Moderator) through this guard rather than through an explicit navigation in the form.
- [`MfaEnrollment`](MfaEnrollment.tsx.md), [`MfaChallenge`](MfaChallenge.tsx.md) and [`StaffHome`](../staff/StaffHome.tsx.md) use the MFA and staff guards; a verified challenge reaches `/staff` through its guard.

Redirect targets are fixed paths; no identifier, token or other personal data is placed in a URL.

## Verification

[`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts.md) covers each rule of `sessionRedirect`, including all 25 status-by-guard cells in one table and the hold while restoring. [`tests/MfaEnrollment.test.ts`](../../tests/MfaEnrollment.test.ts.md) covers the `enabled` hold. The hook's navigation is observed through a mocked router in the sign-in, registration and account tests.

Ticket 09: a `REPLACEMENT_REQUIRED` session belongs at `/staff/mfa/enroll`. Only the `mfa-enrollment` guard accepts it; guest, account, challenge and ordinary staff pages redirect there. Restoration continues to hold redirects until the session is known.
