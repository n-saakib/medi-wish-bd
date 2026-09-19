# `src/app/UserAccessPanel.tsx`

Source: [`src/app/UserAccessPanel.tsx`](../../../src/app/UserAccessPanel.tsx)

## Purpose

Client component for the shared User flow. It provides accessible registration and username/mobile/email sign-in forms, presents only bounded server status/error text, and keeps entered credentials in component state for the active request only.

## Behavior

Registration posts the username, mobile, optional email and password to the public API and clears the password field after either success or failure. Sign-in posts `{identifier,password}` through the memory-only session client, displays the validated public profile, and clears the password after the request. On mount the panel attempts a quiet refresh restore; an authenticated profile exposes a CSRF-protected sign-out action. Registration and sign-in have independent busy, status and error state, while stable status and alert regions support assistive technology. No OTP, MFA, recovery or OAuth flow is added.

## Verification

Strict TypeScript checking, ESLint and the production Next.js build validate the component and its translation provider. Static rendering is covered by `tests/UserAccessPanel.test.ts`; session interactions and API response behavior are covered by `tests/session.test.ts` and `tests/user.test.ts`. Real API/browser verification remains owned by later Ticket 03 integration/sanity work.
