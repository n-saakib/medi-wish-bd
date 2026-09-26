# `src/auth/SessionProvider.tsx`

Source: [`src/auth/SessionProvider.tsx`](../../../src/auth/SessionProvider.tsx)

## Purpose

Client component that holds the browser's signed-in state for every page. It restores the refresh-cookie session once when the application loads, exposes sign-in and sign-out actions, and keeps a short-lived notice that can outlive the page that caused it (for example, a sign-out result shown on the home page). It stores no credentials itself: the access token stays in memory inside [`src/lib/session.ts`](../lib/session.ts.md), and the refresh credential is an HttpOnly cookie on the API origin.

## Exports

- `SessionProvider({ children, source? })` — mounted once by the [root layout](../app/layout.tsx.md). It dispatches `page-change` whenever the pathname changes (see Notices). On mount it records whether an in-memory session existed, calls `restoreSession`, and dispatches `restore-success`, `restore-empty` or `restore-error`; results arriving after unmount are ignored. `source` defaults to the session module's `signIn`, `restoreSession`, `signOut` and `isAuthenticated` and is replaced in tests.
- `useSession()` — returns the context value (state plus `signIn`, `signOut` and `showNotice`) and throws if used outside the provider.
- `sessionReducer`, `initialSessionState` and the types `SessionState`, `SessionNotice`, `SessionSource` and `SessionContextValue`.

## Observable behavior

- **State.** `profile`, `restoring` (initially `true`), `signingIn`, `signingOut` and `notice`. Pages and the header wait for `restoring` to become `false` before deciding what to show or where to redirect.
- **Restore.** A restored profile signs the visitor in. An empty restore leaves them signed out, and sets `sessionExpired` only if an in-memory session existed before the restore. Because the provider mounts once per page load and the access token is memory-only, that check is normally false on a fresh load; the unit tests reach it through an injected source. A failed restore sets `restoreError`, unless a profile is already present or a sign-in is in progress, so a late or overlapping restore failure never contradicts a fresh sign-in.
- **Sign-in.** `signIn(identifier, password)` clears any notice, sets `signingIn`, and on success stores the profile and returns it. On failure it clears `signingIn` and rethrows, so the form reports the error; the provider adds no notice for it.
- **Sign-out.** `signOut()` clears any notice and sets `signingOut`. Success sets `signedOut`. A failed server call still clears the profile and sets `signOutError`: the session client drops the in-memory token before calling the API, so the local session ends either way. `signOut` never rejects.
- **Notices.** `sessionExpired`, `restoreError`, `accountCreated`, `signedOut` and `signOutError`. `showNotice` lets a form set one (registration uses `accountCreated`). Each notice belongs to the page that shows it: `signedOut` and `signOutError` to `/`, the others to `/sign-in`. The provider watches `usePathname()` and dispatches `page-change`; arriving on the notice's page keeps it, any other page drops it, so a notice is shown once and is not repeated on a later visit. The next sign-in or sign-out start also clears it. Notices are keys, not messages, so the page showing them picks the translated text.

## Use cases and boundaries

The provider is the only React owner of session state; forms, the header and the account page read it through `useSession` and do not call `src/lib/session.ts` directly. It does not call `loadUserProfile` or `authenticatedFetch`, so a protected request that expires later does not yet surface through this provider. Error details from the session client are not copied into state.

## Verification

[`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts.md) covers restore outcomes, sign-in and sign-out actions, reducer stale-result guards, notice lifetime and the redirect rules. On 2026-09-26 `npm run test:unit` passed (8 files, 92 tests).
