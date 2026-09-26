# `src/app/UserAccessPanel.tsx`

Source: [`src/app/UserAccessPanel.tsx`](../../../src/app/UserAccessPanel.tsx)

## Purpose

Client component for the shared User flow. It provides accessible registration and username/mobile/email sign-in forms, presents only bounded server status/error text, and keeps entered credentials in component state for the active request only. Restore, sign-in and sign-out state are modeled separately so an expired session or failed logout cannot be mistaken for a login result.

## Behavior

Registration posts the username, mobile, optional email and password to the public API and clears the password field after either success or failure. Sign-in posts `{identifier,password}` through the memory-only session client, displays the validated public profile, clears the password after the request and ends the restore-busy state. Both forms default to `method="post"` so submission before client hydration does not place credentials in the URL. On mount the panel attempts a refresh restore; Strict Mode effect replay starts a current restore while stale completions are ignored. An expired in-memory session gets a translated live-region message and focus, while transport failure gets a separate restore error; restore failures during login or after a profile is established are suppressed so stale feedback cannot appear or return after sign-in. An authenticated profile exposes a CSRF-protected sign-out action with independent pending/success/error feedback; starting sign-out clears the prior login-success announcement, and after the profile disappears focus moves to the populated success status or error alert. Registration and sign-in retain independent busy, status and error state, while stable status and alert regions support assistive technology. No OTP, MFA, recovery or OAuth flow is added.

## Verification

Strict TypeScript checking and ESLint validate the component and its translation provider. The earlier 2026-09-24 13:25 +06 production build failed with `EPERM` opening `.next/trace-build`; a scoped retry at 22:01 +06 passed with the bundled Node 24.19.0 runtime and generated `/` and `/_not-found`. This build does not close the separate live browser/API/PostgreSQL acceptance gates. `tests/UserAccessPanel.test.ts` mounts the component in jsdom and covers sign-in success/failure, pending state, password clearing, restore/expiry, logout, accessible feedback and focus. A synthetic Chrome smoke check during this implementation verified Strict Mode restore completion with one refresh request, successful/failed sign-out focus, and POST submission without a password query when JavaScript was disabled; it is not a committed browser test. The fresh-profile Ticket 03 browser evidence covers registration, sign-in, reload-triggered refresh, invalid credentials, logout, storage, CORS and keyboard focus. Browser verification of the expired-protected-request retry remains deferred until a genuine product action uses that request helper.
