# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell. It mounts the `next-intl` provider and one `SessionProvider` around three route groups that add no URL segment: `(store)` renders the store header above the home page (`/`), the account page (`/account`) and the profile editor (`/account/profile`), `(auth)` renders a reduced header above the sign-in (`/sign-in`), registration (`/register`), authenticator setup (`/staff/mfa/enroll`) and authenticator code (`/staff/mfa`) pages, and `(staff)` renders the staff header above the staff landing page (`/staff`). `src/i18n/request.ts` supplies the English messages. Feature code is grouped by feature: `src/auth/` (session provider, redirect rules, sign-in and registration forms, sign-out notice), `src/account/` (account summary, profile editor and native mobile-change dialog), `src/staff/` (staff landing) and `src/shell/` (headers, logo, icons, alerts). `src/lib/api.ts` is the shared HTTP boundary (request defaults, 10-second timeout, bounded `ApiError`) under `src/lib/session.ts`, `src/lib/user.ts`, `src/lib/staff.ts` and `src/lib/profile.ts`. `src/lib/health.ts` is the small API health boundary used by the unit tests, the real-backend integration test, and `tools/health-probe.ts`; a controlled-fixture integration test exercises the CLI process and exit-code contract.

Every route is statically generated. The access token stays memory-only in `src/lib/session.ts` and the refresh credential is an HttpOnly cookie on the API origin, so the signed-in state is known only in the browser: the provider restores the session once per page load, and `sessionRedirect` holds every redirect until that restore finishes. A refresh `204` means no session and a `401` an expired one, which the sign-in page announces. `/account` sends signed-out visitors to `/sign-in`, but to `/` right after a sign-out, and stays put while sign-out is pending; `/sign-in` and `/register` send a signed-in user to the page for the session's MFA status: `/account` when no MFA is required, `/staff/mfa/enroll` when an authenticator must be set up, `/staff/mfa` when a code is required and `/staff` once verified. The staff pages admit only their own status, send other sessions to that page, and send signed-out visitors to `/sign-in`; `/account` also admits a verified staff session. The store header shows no account link until the restore finishes, then either `Sign in` or the username.

Sign-in shows one alert on failure, clears the password and refocuses the identifier; session-expired, restore-failure and account-created notices appear only when they occur and receive focus. Registration omits a blank email, clears the password at submit and, on any `201`, signs in with the same credentials (accepted decision D1); if that sign-in fails, the visitor is sent to `/sign-in` with an account-created notice and no identifiers in the URL. Error alerts show `messages/en.json` copy chosen by error code, never the API's message text. `/account` loads the current profile with `GET /api/user/me` through the provider's `authenticatedFetch` and shows a loading status, the profile or a generic error; a request still unauthorized after one refresh ends the session and sends the visitor to `/sign-in`. Sign-out ends the local session even if the server call fails; the home page announces and focuses the result and offers `Try again` after a failure. Both forms use `method="post"` so a pre-hydration submission cannot put credentials in the URL. The pages follow `agent-docs/ui-design/` (`home.html`, `sign-in.html`, `register.html`); each page's mirror records its deliberate deviations, such as the header without search, cart or category navigation and the 6–30 character password hint.

The session client keeps the access token in memory, refuses off-origin Bearer requests before fetching, refreshes before a request when no token is in memory, retries a `401` once after one refresh, and serializes sign-in, refresh and logout cookie mutations across same-origin tabs with the Web Locks API, or within the tab where Web Locks are unavailable (an insecure context). Every API call is aborted after 10 seconds. Admin and Moderator sessions start restricted: setup shows a QR code (drawn locally by `qrcode`) and the key, verifies a 6-digit code and shows the ten backup codes once before `/staff`; the code page verifies returning staff. Both verify calls replace the restricted access token under the cookie lock. The setup secret and backup codes live only in component state, are cleared on unmount and `pagehide`, and never reach storage, the URL or the console; `/staff/*` responses carry `Cache-Control: no-store`. `/staff` shows only the verified username, roles and Super Admin flag from `GET /api/staff/me`. Product, cart, order, OTP, backup-code sign-in, recovery and OAuth features remain intentionally absent from this slice.

`/account/profile` uses the same account guard and loads the caller-owned nine-field profile through `src/lib/profile.ts`. It saves only Full name, Email, Date of birth and the loaded version; stale saves offer Reload. Mobile stage/cancel preserve any unsaved draft and its original version, and closure makes every command read-only. A reducer-owned session generation hides old profile data and ignores late answers from earlier sessions. The native dialog stages a new mobile without sending SMS or exposing an activation route. Registration uses the accepted username 3–20, mobile 11 and email 254-character input bounds; existing profiles remain readable under the wider legacy response bounds.

## Architecture maps

| Map | Documentation |
| --- | --- |
| Frontend code architecture | [`code-architecture.md`](code-architecture.md) |

## Source mirror

| Project file | Documentation |
| --- | --- |
| [`src/app/globals.css`](../src/app/globals.css) | [`src/app/globals.css.md`](src/app/globals.css.md) — design tokens and components ported from the page designs |
| [`src/app/layout.tsx`](../src/app/layout.tsx) | [`src/app/layout.tsx.md`](src/app/layout.tsx.md) |
| [`src/app/icon.svg`](../src/app/icon.svg) | [`src/app/icon.svg.md`](src/app/icon.svg.md) — site icon (the logo mark) |
| [`src/app/(store)/layout.tsx`](../src/app/(store)/layout.tsx) | [`src/app/(store)/layout.tsx.md`](src/app/(store)/layout.tsx.md) |
| [`src/app/(store)/page.tsx`](../src/app/(store)/page.tsx) | [`src/app/(store)/page.tsx.md`](src/app/(store)/page.tsx.md) |
| [`src/app/(store)/account/page.tsx`](../src/app/(store)/account/page.tsx) | [`src/app/(store)/account/page.tsx.md`](src/app/(store)/account/page.tsx.md) |
| [`src/app/(auth)/layout.tsx`](../src/app/(auth)/layout.tsx) | [`src/app/(auth)/layout.tsx.md`](src/app/(auth)/layout.tsx.md) |
| [`src/app/(auth)/sign-in/page.tsx`](../src/app/(auth)/sign-in/page.tsx) | [`src/app/(auth)/sign-in/page.tsx.md`](src/app/(auth)/sign-in/page.tsx.md) |
| [`src/app/(auth)/register/page.tsx`](../src/app/(auth)/register/page.tsx) | [`src/app/(auth)/register/page.tsx.md`](src/app/(auth)/register/page.tsx.md) |
| [`src/app/(auth)/staff/mfa/page.tsx`](../src/app/(auth)/staff/mfa/page.tsx) | [`src/app/(auth)/staff/mfa/page.tsx.md`](src/app/(auth)/staff/mfa/page.tsx.md) |
| [`src/app/(auth)/staff/mfa/enroll/page.tsx`](../src/app/(auth)/staff/mfa/enroll/page.tsx) | [`src/app/(auth)/staff/mfa/enroll/page.tsx.md`](src/app/(auth)/staff/mfa/enroll/page.tsx.md) |
| [`src/app/(staff)/layout.tsx`](../src/app/(staff)/layout.tsx) | [`src/app/(staff)/layout.tsx.md`](src/app/(staff)/layout.tsx.md) |
| [`src/app/(staff)/staff/page.tsx`](../src/app/(staff)/staff/page.tsx) | [`src/app/(staff)/staff/page.tsx.md`](src/app/(staff)/staff/page.tsx.md) |
| [`src/auth/SessionProvider.tsx`](../src/auth/SessionProvider.tsx) | [`src/auth/SessionProvider.tsx.md`](src/auth/SessionProvider.tsx.md) |
| [`src/auth/sessionRedirect.ts`](../src/auth/sessionRedirect.ts) | [`src/auth/sessionRedirect.ts.md`](src/auth/sessionRedirect.ts.md) |
| [`src/auth/SignInForm.tsx`](../src/auth/SignInForm.tsx) | [`src/auth/SignInForm.tsx.md`](src/auth/SignInForm.tsx.md) |
| [`src/auth/RegistrationForm.tsx`](../src/auth/RegistrationForm.tsx) | [`src/auth/RegistrationForm.tsx.md`](src/auth/RegistrationForm.tsx.md) |
| [`src/auth/SignOutNotice.tsx`](../src/auth/SignOutNotice.tsx) | [`src/auth/SignOutNotice.tsx.md`](src/auth/SignOutNotice.tsx.md) |
| [`src/auth/MfaEnrollment.tsx`](../src/auth/MfaEnrollment.tsx) | [`src/auth/MfaEnrollment.tsx.md`](src/auth/MfaEnrollment.tsx.md) |
| [`src/auth/MfaChallenge.tsx`](../src/auth/MfaChallenge.tsx) | [`src/auth/MfaChallenge.tsx.md`](src/auth/MfaChallenge.tsx.md) |
| [`src/auth/AuthenticatorCodeField.tsx`](../src/auth/AuthenticatorCodeField.tsx) | [`src/auth/AuthenticatorCodeField.tsx.md`](src/auth/AuthenticatorCodeField.tsx.md) |
| [`src/auth/BackupCodesPanel.tsx`](../src/auth/BackupCodesPanel.tsx) | [`src/auth/BackupCodesPanel.tsx.md`](src/auth/BackupCodesPanel.tsx.md) |
| [`src/account/AccountSummary.tsx`](../src/account/AccountSummary.tsx) | [`src/account/AccountSummary.tsx.md`](src/account/AccountSummary.tsx.md) |
| [`src/staff/StaffHome.tsx`](../src/staff/StaffHome.tsx) | [`src/staff/StaffHome.tsx.md`](src/staff/StaffHome.tsx.md) |
| [`src/shell/SiteHeader.tsx`](../src/shell/SiteHeader.tsx) | [`src/shell/SiteHeader.tsx.md`](src/shell/SiteHeader.tsx.md) |
| [`src/shell/AuthHeader.tsx`](../src/shell/AuthHeader.tsx) | [`src/shell/AuthHeader.tsx.md`](src/shell/AuthHeader.tsx.md) |
| [`src/shell/StaffHeader.tsx`](../src/shell/StaffHeader.tsx) | [`src/shell/StaffHeader.tsx.md`](src/shell/StaffHeader.tsx.md) |
| [`src/shell/Logo.tsx`](../src/shell/Logo.tsx) | [`src/shell/Logo.tsx.md`](src/shell/Logo.tsx.md) |
| [`src/shell/Icon.tsx`](../src/shell/Icon.tsx) | [`src/shell/Icon.tsx.md`](src/shell/Icon.tsx.md) |
| [`src/shell/Alert.tsx`](../src/shell/Alert.tsx) | [`src/shell/Alert.tsx.md`](src/shell/Alert.tsx.md) |
| [`src/i18n/request.ts`](../src/i18n/request.ts) | [`src/i18n/request.ts.md`](src/i18n/request.ts.md) |
| [`src/lib/health.ts`](../src/lib/health.ts) | [`src/lib/health.ts.md`](src/lib/health.ts.md) |
| [`src/lib/api.ts`](../src/lib/api.ts) | [`src/lib/api.ts.md`](src/lib/api.ts.md) |
| [`src/lib/session.ts`](../src/lib/session.ts) | [`src/lib/session.ts.md`](src/lib/session.ts.md) |
| [`src/lib/user.ts`](../src/lib/user.ts) | [`src/lib/user.ts.md`](src/lib/user.ts.md) |
| [`src/lib/staff.ts`](../src/lib/staff.ts) | [`src/lib/staff.ts.md`](src/lib/staff.ts.md) |
| [`messages/en.json`](../messages/en.json) | [`messages/en.json.md`](messages/en.json.md) |
| [`tests/health.test.ts`](../tests/health.test.ts) | [`tests/health.test.ts.md`](tests/health.test.ts.md) |
| [`tests/health.integration.test.ts`](../tests/health.integration.test.ts) | [`tests/health.integration.test.ts.md`](tests/health.integration.test.ts.md) |
| [`tests/health-probe.integration.test.ts`](../tests/health-probe.integration.test.ts) | [`tests/health-probe.integration.test.ts.md`](tests/health-probe.integration.test.ts.md) |
| [`tests/session.test.ts`](../tests/session.test.ts) | [`tests/session.test.ts.md`](tests/session.test.ts.md) |
| [`tests/user.test.ts`](../tests/user.test.ts) | [`tests/user.test.ts.md`](tests/user.test.ts.md) |
| [`tests/SessionProvider.test.ts`](../tests/SessionProvider.test.ts) | [`tests/SessionProvider.test.ts.md`](tests/SessionProvider.test.ts.md) |
| [`tests/testApi.test.ts`](../tests/testApi.test.ts) | [`tests/testApi.test.ts.md`](tests/testApi.test.ts.md) — unit checks of the browser-test API setup |
| [`tests/totp.test.ts`](../tests/totp.test.ts) | [`tests/totp.test.ts.md`](tests/totp.test.ts.md) — RFC 6238 vectors for the test authenticator |
| [`tests/session.integration.test.ts`](../tests/session.integration.test.ts) | [`tests/session.integration.test.ts.md`](tests/session.integration.test.ts.md) |
| [`tests/SiteHeader.test.ts`](../tests/SiteHeader.test.ts) | [`tests/SiteHeader.test.ts.md`](tests/SiteHeader.test.ts.md) |
| [`tests/SignInForm.test.ts`](../tests/SignInForm.test.ts) | [`tests/SignInForm.test.ts.md`](tests/SignInForm.test.ts.md) |
| [`tests/RegistrationForm.test.ts`](../tests/RegistrationForm.test.ts) | [`tests/RegistrationForm.test.ts.md`](tests/RegistrationForm.test.ts.md) |
| [`tests/AccountSummary.test.ts`](../tests/AccountSummary.test.ts) | [`tests/AccountSummary.test.ts.md`](tests/AccountSummary.test.ts.md) |
| [`tests/MfaEnrollment.test.ts`](../tests/MfaEnrollment.test.ts) | [`tests/MfaEnrollment.test.ts.md`](tests/MfaEnrollment.test.ts.md) |
| [`tests/MfaChallenge.test.ts`](../tests/MfaChallenge.test.ts) | [`tests/MfaChallenge.test.ts.md`](tests/MfaChallenge.test.ts.md) |
| [`tests/BackupCodesPanel.test.ts`](../tests/BackupCodesPanel.test.ts) | [`tests/BackupCodesPanel.test.ts.md`](tests/BackupCodesPanel.test.ts.md) |
| [`tests/StaffHome.test.ts`](../tests/StaffHome.test.ts) | [`tests/StaffHome.test.ts.md`](tests/StaffHome.test.ts.md) |
| [`tests/renderWithSession.ts`](../tests/renderWithSession.ts) | [`tests/renderWithSession.ts.md`](tests/renderWithSession.ts.md) — shared mounted-test helper, not a test file |
| [`tests/fakeApi.ts`](../tests/fakeApi.ts) | [`tests/fakeApi.ts.md`](tests/fakeApi.ts.md) — shared API, lock and promise fakes, not a test file |
| [`tests/browser/journey.spec.ts`](../tests/browser/journey.spec.ts) | [`tests/browser/journey.spec.ts.md`](tests/browser/journey.spec.ts.md) |
| [`tests/browser/privacy.spec.ts`](../tests/browser/privacy.spec.ts) | [`tests/browser/privacy.spec.ts.md`](tests/browser/privacy.spec.ts.md) |
| [`tests/browser/profileApi.spec.ts`](../tests/browser/profileApi.spec.ts) | [`tests/browser/profileApi.spec.ts.md`](tests/browser/profileApi.spec.ts.md) — Ticket 11 API acceptance tests, including all-role and enrollment/challenge MFA route permissions (`@t11-T4`; E2E-11-50 `@t11-T2`) |
| [`tests/browser/profile.spec.ts`](../tests/browser/profile.spec.ts) | [`tests/browser/profile.spec.ts.md`](tests/browser/profile.spec.ts.md) — Ticket 11 browser acceptance tests (`@t11-T5`), including native successful-stage focus |
| [`tests/browser/profileSupport.ts`](../tests/browser/profileSupport.ts) | [`tests/browser/profileSupport.ts.md`](tests/browser/profileSupport.ts.md) — Ticket 11 spec helpers and contract strings, not a spec |
| [`tests/browser/matrix.spec.ts`](../tests/browser/matrix.spec.ts) | [`tests/browser/matrix.spec.ts.md`](tests/browser/matrix.spec.ts.md) |
| [`tests/browser/staffMfa.spec.ts`](../tests/browser/staffMfa.spec.ts) | [`tests/browser/staffMfa.spec.ts.md`](tests/browser/staffMfa.spec.ts.md) |
| [`tests/browser/totp.ts`](../tests/browser/totp.ts) | [`tests/browser/totp.ts.md`](tests/browser/totp.ts.md) — test-only RFC 6238 code generator, not a spec |
| [`tests/browser/support.ts`](../tests/browser/support.ts) | [`tests/browser/support.ts.md`](tests/browser/support.ts.md) — shared browser-spec helpers, not a spec |
| [`tests/browser/testApi.ts`](../tests/browser/testApi.ts) | [`tests/browser/testApi.ts.md`](tests/browser/testApi.ts.md) — Playwright global setup that starts the test API |
| [`tools/health-probe.ts`](../tools/health-probe.ts) | [`tools/health-probe.ts.md`](tools/health-probe.ts.md) |
| [`package.json`](../package.json) | [`package.json.md`](package.json.md) |
| [`package-lock.json`](../package-lock.json) | [`package-lock.json.md`](package-lock.json.md) |
| [`next.config.ts`](../next.config.ts) | [`next.config.ts.md`](next.config.ts.md) |
| [`tsconfig.json`](../tsconfig.json) | [`tsconfig.json.md`](tsconfig.json.md) |
| [`vitest.config.ts`](../vitest.config.ts) | [`vitest.config.ts.md`](vitest.config.ts.md) |
| [`playwright.config.ts`](../playwright.config.ts) | [`playwright.config.ts.md`](playwright.config.ts.md) |
| [`eslint.config.mjs`](../eslint.config.mjs) | [`eslint.config.mjs.md`](eslint.config.mjs.md) |
| [`public/.gitkeep`](../public/.gitkeep) | [`public/.gitkeep.md`](public/.gitkeep.md) |
| [`.npmrc`](../.npmrc) | [`.npmrc.md`](.npmrc.md) |
| [tests/profile.integration.test.ts](../tests/profile.integration.test.ts) | [profile.integration.test.ts.md](tests/profile.integration.test.ts.md) — real anonymous-profile contract |
| [`.gitignore`](../.gitignore) | [`.gitignore.md`](.gitignore.md) |
| [`src/app/(store)/account/profile/page.tsx`](../src/app/(store)/account/profile/page.tsx) | [`src/app/(store)/account/profile/page.tsx.md`](src/app/(store)/account/profile/page.tsx.md) |
| [`src/account/ProfileForm.tsx`](../src/account/ProfileForm.tsx) | [`src/account/ProfileForm.tsx.md`](src/account/ProfileForm.tsx.md) |
| [`src/account/MobileChangeDialog.tsx`](../src/account/MobileChangeDialog.tsx) | [`src/account/MobileChangeDialog.tsx.md`](src/account/MobileChangeDialog.tsx.md) — native close and focus after the parent render |
| [`src/lib/profile.ts`](../src/lib/profile.ts) | [`src/lib/profile.ts.md`](src/lib/profile.ts.md) |
| [`src/lib/identifiers.ts`](../src/lib/identifiers.ts) | [`src/lib/identifiers.ts.md`](src/lib/identifiers.ts.md) |
| [`tests/ProfileForm.test.tsx`](../tests/ProfileForm.test.tsx) | [`tests/ProfileForm.test.tsx.md`](tests/ProfileForm.test.tsx.md) — mounted state, ordering, focus and trimmed-name boundary cases |
| [`tests/profile.test.ts`](../tests/profile.test.ts) | [`tests/profile.test.ts.md`](tests/profile.test.ts.md) |
| [`tests/identifiers.test.ts`](../tests/identifiers.test.ts) | [`tests/identifiers.test.ts.md`](tests/identifiers.test.ts.md) |

## Commands and environment

The package requires Node.js `>=24.15.0 <25` and npm `11.19.0`, and pins Next.js `16.3.6`; the [manifest page](package.json.md) records the security-update rationale. From `frontend/`, use `npm ci` to install the locked dependency graph. `npm run verify` runs linting, strict TypeScript checking, unit tests, and the production build. The full `npm run test:integration` suite and `npm run probe` require a running backend URL in `MEDI_WISH_API_URL`; the focused CLI process test can run without the backend using `npx vitest run --project integration tests/health-probe.integration.test.ts`. The probe otherwise targets `http://127.0.0.1:8080`.

Unit tests use injected or stubbed fetch functions, the shared `tests/fakeApi.ts` routes and injected session sources, so they do not require a server. They cover the registration and profile calls, the memory-only session lifecycle (restore `204`/`401`/other failures, refreshing before a request without a token, the single retry, sign-out races), the cross-tab lock, the 10-second timeouts and error-code copy. Mounted jsdom tests render the session provider, store and staff headers, sign-in and registration forms, account summary, authenticator setup and code pages, backup codes and staff landing through `tests/renderWithSession.ts` with a mocked router, several with a real session client over the fake API; they cover restore and redirect rules, the `/account` loading, profile, expiry and error states, the sign-out retry, POST form defaults, busy and password-clearing behavior, bounded alerts, focused notices, and keeping the access token and registration details out of URLs; the MFA tests cover the full status-by-guard redirect table, only the latest setup being shown, stale, invalid and locked codes, clearing secrets on `pagehide` and unmount, and keeping secrets and backup codes out of storage, URLs and the console. `tests/testApi.test.ts` unit-tests the browser-test setup itself: the filtered environment, the run's own MFA key, the occupied-port refusal, cleanup after a failed start and the `grantRole` guards; `tests/totp.test.ts` checks the test authenticator against the RFC 6238 vectors. `npm run test:browser` builds the frontend for the test API and runs the Playwright journey, privacy, matrix and staff MFA specs on the installed Chrome and Edge (`--grep @smoke` runs only the Admin enrollment smoke path); the [test API page](tests/browser/testApi.ts.md) lists its database settings and the command that runs `test:integration` and `probe` against the same API. On 2026-09-27, on the working tree over revision `bef3b76` with the staff MFA changes, `npm run verify` passed: lint, typecheck, `npm run test:unit` (14 files, 255 tests) and `npm run build`, which produced static `/`, `/account`, `/register`, `/sign-in`, `/staff`, `/staff/mfa`, `/staff/mfa/enroll` and `/icon.svg`. Against the test API started by `tests/browser/testApi.ts` (PostgreSQL 18 on `127.0.0.1:55432`, backend jar built with `./mvnw.cmd -o -q package -DskipTests`), `npm run test:integration` (3 files, 4 tests) and `npm run probe` (`{"liveness":"up","readiness":"up"}`) passed, and `npm run test:browser` passed 22 tests (11 per channel) on Chrome 154.0.8037.57 and Edge 154.0.4258.37; `npx playwright test --grep @smoke` passed 2. The test API's teardown left no run role and freed ports 18080 and 3100. The integration suite includes a live-backend test that fails with a setup message when its URL is absent and the health-probe CLI test that uses its own controlled local fixture.

**Ticket acceptance tests.** End-to-end tests written ahead of a ticket are named `E2E-<ticket>-<nn> <title>` and tagged `{ tag: ['@t<ticket>', '@t<ticket>-T<n>'] }`, with exactly one sub-ticket tag: the sub-ticket whose completion first makes the test pass. A sub-ticket's gate is `npm run test:browser -- --grep @t<ticket>-T<n>` plus every earlier gate of that ticket, and `--grep @t<ticket>` runs the whole ticket. Run one browser run at a time, because the test API and the frontend use fixed ports 18080 and 3100. A ticket's smoke path also carries `@smoke`. Tests that need two tickets are tagged `@cross-<a>-<b>` and are added by whichever of the two merges second. Each spec's page lists its IDs and whether they have run; the ID tables and gates are in §10 of each ticket's implementation plan. `testApi.ts` and `support.ts` are shared by these tickets: change them identically on every open ticket branch, or after the others merge.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior.
