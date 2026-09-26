# `tests/UserAccessPanel.test.ts`

Source: [`tests/UserAccessPanel.test.ts`](../../tests/UserAccessPanel.test.ts)

## Purpose

Mounted DOM interaction and reducer coverage for the user access panel’s registration, sign-in, restore/expiry, logout, password clearing, and accessible feedback/focus behavior. Registration tests stub only the external `fetch` boundary; session behavior continues to use the existing session seam. The test uses Vitest with jsdom `30.1.1` and React DOM directly; it does not add a component-testing framework. jsdom’s corrected focus/blur behavior is covered by the focus assertions; the frontend package requires Node `>=24.15.0 <25` to match jsdom’s engine.

## Verification

Static assertions retain the identifier contract, POST defaults, focusable live regions, independent forms, and removed-Basic/storage checks. Mounted registration tests observe a successful `201` projection and bounded transport failure, assert the public registration route, and verify the registration password is cleared on either outcome. Mounted sign-in tests exercise success/failure, pending/disabled state, password clearing, restored profile, bounded restore failure, quiet empty restore, expiry announcement and focus, logout success/failure, bounded feedback, and focus movement. The rendered successful sign-in privacy regression uses the real session client with a controlled HTTP boundary, then checks the browser URL, query, fragment, history state and observed history writes for the synthetic access token. The login-then-logout interaction also asserts that the obsolete login-success announcement is cleared while sign-out confirmation remains visible. Mounted test helpers wrap DOM input events in `act` and flush resolved async event work before asserting, keeping React's test warnings meaningful. Reducer assertions continue to cover feedback separation and late restore races. These deterministic component tests do not replace the real API browser journey or supported-browser matrix. The protected-request retry remains open under Ticket 03 T5/T7.
