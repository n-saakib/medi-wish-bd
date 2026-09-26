# `src/auth/SessionProvider.tsx`

Source: [`src/auth/SessionProvider.tsx`](../../../src/auth/SessionProvider.tsx)

## Purpose

Client component that holds the browser's signed-in state for every page. It restores the refresh-cookie session once when the application loads, exposes sign-in and sign-out actions, and keeps a short-lived notice that can outlive the page that caused it (for example, a sign-out result shown on the home page). It stores no credentials itself: the access token stays in memory inside [`src/lib/session.ts`](../lib/session.ts.md), and the refresh credential is an HttpOnly cookie on the API origin.

## Exports

- `SessionProvider({ children, source? })` — mounted once by the [root layout](../app/layout.tsx.md). It dispatches `page-change` whenever the pathname changes (see Notices). On mount it calls `restoreSession` and dispatches `restore-success`, `restore-empty` or `restore-error`; results arriving after unmount are ignored. `source` defaults to the session module's `signIn`, `restoreSession`, `signOut` and `authenticatedFetch`, and tests replace it with a mock source or a real client over a fake `fetch`.
- `useSession()` — returns the context value (state plus `signIn`, `signOut`, `authenticatedFetch` and `showNotice`) and throws if used outside the provider.
- `sessionReducer`, `initialSessionState` and the types `SessionState`, `SessionNotice`, `SessionSource` and `SessionContextValue`.

## Observable behavior

- **State.** `profile`, `restoring` (initially `true`), `signingIn`, `signingOut` and `notice`. Pages and the header wait for `restoring` to become `false` before deciding what to show or where to redirect.
- **Restore.** A restored profile signs the visitor in. An empty restore (the API answered `204`: no refresh cookie) leaves them quietly signed out. A `401` means the cookie has expired or was revoked and sets `sessionExpired`; any other failure sets `restoreError`. Neither notice is set when a profile is already present or a sign-in is in progress, so a late or overlapping restore failure never contradicts a fresh sign-in.
- **Protected requests.** `authenticatedFetch` passes the call to the session client. When it rejects with a `401` (still unauthorized after the client's single refresh) the `expire` action clears the profile and sets `sessionExpired`, so the account guard sends the visitor to `/sign-in`; the rejection is rethrown either way.
- **Sign-in.** `signIn(identifier, password)` clears any notice, sets `signingIn`, and on success stores the profile and returns it. On failure it clears `signingIn` and rethrows, so the form reports the error; the provider adds no notice for it.
- **Sign-out.** `signOut()` sets `signingOut` and leaves the notice alone, so a retried sign-out keeps its alert until the retry settles. Success sets `signedOut`. A failed server call still clears the profile and sets `signOutError`: the session client drops the in-memory token before calling the API, so the local session ends either way. `signOut` never rejects, and calling it again retries the logout.
- **Notices.** `sessionExpired`, `restoreError`, `accountCreated`, `signedOut` and `signOutError`. `showNotice` lets a form set one (registration uses `accountCreated`). Each notice belongs to the page that shows it: `signedOut` and `signOutError` to `/`, the others to `/sign-in`. The provider watches `usePathname()` and dispatches `page-change`; arriving on the notice's page keeps it, any other page drops it, so a notice is shown once and is not repeated on a later visit. The next sign-in start also clears it; a sign-out result replaces it. Notices are keys, not messages, so the page showing them picks the translated text.

## Use cases and boundaries

The provider is the only React owner of session state; forms, the header and the account page read it through `useSession` and do not call `src/lib/session.ts` directly. Protected requests go through its `authenticatedFetch` so an expired session always reaches the UI. Error details from the session client are not copied into state.

## Verification

[`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts.md) covers restore outcomes (including a real client whose refresh answers `401`), sign-in and sign-out actions, a protected request that expires or fails otherwise, reducer stale-result guards, notice lifetime and the redirect rules.
