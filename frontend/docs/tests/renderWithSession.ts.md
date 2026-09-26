# `tests/renderWithSession.ts`

Source: [`tests/renderWithSession.ts`](../../tests/renderWithSession.ts)

## Purpose

Shared helper for the mounted component tests. It is not a test file itself (it does not match `*.test.ts`), so Vitest loads it only through imports. It mounts components with React DOM under jsdom inside the real `NextIntlClientProvider` (with `messages/en.json`) and the real [`SessionProvider`](../src/auth/SessionProvider.tsx.md), with an injected session source instead of the network.

## Exports

- `signedInUser` and `signedInResponse` — synthetic profile and sign-in response fixtures.
- `createSessionSource(overrides?)` — a signed-out `SessionSource` of Vitest mocks (sign-in succeeds, restore finds no session, sign-out succeeds, no in-memory session); tests override individual methods.
- `renderWithSession(element, source?)` — mounts the element in a new container, waits for the provider's restore to settle and returns the container.
- `settle()` — flushes pending promises and the effects they trigger inside `act`.
- `unmountAll()` — unmounts every mounted root and clears the document body; used in `afterEach`.
- `requiredElement(container, selector)` — `querySelector` that throws if the element is missing.
- `setInputValue(container, selector, value)` — sets an input through the native value setter and dispatches `input`, so React's `onChange` runs.
- `submitForm(container)` — dispatches a cancelable `submit` on the first form without waiting for the requests it starts.
- `deferred()` — a promise with external `resolve`/`reject`, used to hold a request open mid-test.

The module also sets `IS_REACT_ACT_ENVIRONMENT` so React's `act` warnings stay meaningful.

## Use cases

Used by the `SessionProvider`, `SiteHeader`, `SignInForm`, `RegistrationForm` and `AccountSummary` tests. Test files that exercise navigation mock `next/navigation`'s `useRouter` themselves.

## Verification

Exercised by those five suites; on 2026-09-26 `npm run test:unit` passed (8 files, 92 tests) and `npm run typecheck` and `npm run lint` passed over this file.
