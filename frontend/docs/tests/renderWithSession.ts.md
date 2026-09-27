# `tests/renderWithSession.ts`

Source: [`tests/renderWithSession.ts`](../../tests/renderWithSession.ts)

## Purpose

Shared helper for the mounted component tests. It is not a test file itself (it does not match `*.test.ts`), so Vitest loads it only through imports. It mounts components with React DOM under jsdom inside the real `NextIntlClientProvider` (with `messages/en.json`) and the real [`SessionProvider`](../src/auth/SessionProvider.tsx.md), with an injected session source instead of the network.

## Exports

- `signedInResponse` — the session client's sign-in result for the shared [`fakeApi`](fakeApi.ts.md) `signedInUser`, with MFA status `NOT_REQUIRED`.
- `createSessionSource(overrides?)` — a signed-out `SessionSource` of Vitest mocks (sign-in succeeds, restore finds no session, sign-out succeeds, protected requests and the three MFA methods reject with a `401` `ApiError`); tests override individual methods, or pass a real session client instead.
- `renderWithSession(element, source?)` — mounts the element in a new container, waits for the provider's restore to settle and returns the container.
- `settle()` — runs `fakeApi`'s `flushTasks` inside `act`, so pending promises and the effects they trigger finish.
- `unmountAll()` — unmounts every mounted root and clears the document body; used in `afterEach`.
- `requiredElement(container, selector)` — `querySelector` that throws if the element is missing.
- `setInputValue(container, selector, value)` — sets an input through the native value setter and dispatches `input`, so React's `onChange` runs.
- `submitForm(container)` — dispatches a cancelable `submit` on the first form without waiting for the requests it starts.

The module also sets `IS_REACT_ACT_ENVIRONMENT` so React's `act` warnings stay meaningful.

## Use cases

Used by the `SessionProvider`, `SiteHeader`, `SignInForm`, `RegistrationForm`, `AccountSummary`, `MfaEnrollment`, `MfaChallenge`, `BackupCodesPanel` and `StaffHome` tests. Test files that exercise navigation mock `next/navigation`'s `useRouter` themselves.

## Verification

Exercised by those nine suites; on 2026-09-27 `npm run verify` passed over this file.
