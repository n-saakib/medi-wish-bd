# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell. It mounts the `next-intl` provider and one `SessionProvider` around two route groups that add no URL segment: `(store)` renders the store header above the home page (`/`) and the account page (`/account`), and `(auth)` renders a reduced header above the sign-in (`/sign-in`) and registration (`/register`) pages. `src/i18n/request.ts` supplies the English messages. Feature code is grouped by feature: `src/auth/` (session provider, redirect rules, sign-in and registration forms, sign-out notice), `src/account/` (account summary) and `src/shell/` (headers, logo, icons, alerts). `src/lib/api.ts` is the shared HTTP boundary (request defaults, 10-second timeout, bounded `ApiError`) under `src/lib/session.ts` and `src/lib/user.ts`. `src/lib/health.ts` is the small API health boundary used by the unit tests, the real-backend integration test, and `tools/health-probe.ts`; a controlled-fixture integration test exercises the CLI process and exit-code contract.

Every route is statically generated. The access token stays memory-only in `src/lib/session.ts` and the refresh credential is an HttpOnly cookie on the API origin, so the signed-in state is known only in the browser: the provider restores the session once per page load, and `sessionRedirect` holds every redirect until that restore finishes. A refresh `204` means no session and a `401` an expired one, which the sign-in page announces. `/account` sends signed-out visitors to `/sign-in`, but to `/` right after a sign-out, and stays put while sign-out is pending; `/sign-in` and `/register` send signed-in users to `/account`. The store header shows no account link until the restore finishes, then either `Sign in` or the username.

Sign-in shows one alert on failure, clears the password and refocuses the identifier; session-expired, restore-failure and account-created notices appear only when they occur and receive focus. Registration omits a blank email, clears the password at submit and, on any `201`, signs in with the same credentials (accepted decision D1); if that sign-in fails, the visitor is sent to `/sign-in` with an account-created notice and no identifiers in the URL. Error alerts show `messages/en.json` copy chosen by error code, never the API's message text. `/account` loads the current profile with `GET /api/user/me` through the provider's `authenticatedFetch` and shows a loading status, the profile or a generic error; a request still unauthorized after one refresh ends the session and sends the visitor to `/sign-in`. Sign-out ends the local session even if the server call fails; the home page announces and focuses the result and offers `Try again` after a failure. Both forms use `method="post"` so a pre-hydration submission cannot put credentials in the URL. The pages follow `agent-docs/ui-design/` (`home.html`, `sign-in.html`, `register.html`); each page's mirror records its deliberate deviations, such as the header without search, cart or category navigation and the 6–30 character password hint.

The session client keeps the access token in memory, refuses off-origin Bearer requests before fetching, refreshes before a request when no token is in memory, retries a `401` once after one refresh, and serializes sign-in, refresh and logout cookie mutations across same-origin tabs with the Web Locks API, or within the tab where Web Locks are unavailable (an insecure context). Every API call is aborted after 10 seconds. Product, cart, order, staff, OTP, MFA, recovery and OAuth features remain intentionally absent from this slice.

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
| [`src/auth/SessionProvider.tsx`](../src/auth/SessionProvider.tsx) | [`src/auth/SessionProvider.tsx.md`](src/auth/SessionProvider.tsx.md) |
| [`src/auth/sessionRedirect.ts`](../src/auth/sessionRedirect.ts) | [`src/auth/sessionRedirect.ts.md`](src/auth/sessionRedirect.ts.md) |
| [`src/auth/SignInForm.tsx`](../src/auth/SignInForm.tsx) | [`src/auth/SignInForm.tsx.md`](src/auth/SignInForm.tsx.md) |
| [`src/auth/RegistrationForm.tsx`](../src/auth/RegistrationForm.tsx) | [`src/auth/RegistrationForm.tsx.md`](src/auth/RegistrationForm.tsx.md) |
| [`src/auth/SignOutNotice.tsx`](../src/auth/SignOutNotice.tsx) | [`src/auth/SignOutNotice.tsx.md`](src/auth/SignOutNotice.tsx.md) |
| [`src/account/AccountSummary.tsx`](../src/account/AccountSummary.tsx) | [`src/account/AccountSummary.tsx.md`](src/account/AccountSummary.tsx.md) |
| [`src/shell/SiteHeader.tsx`](../src/shell/SiteHeader.tsx) | [`src/shell/SiteHeader.tsx.md`](src/shell/SiteHeader.tsx.md) |
| [`src/shell/AuthHeader.tsx`](../src/shell/AuthHeader.tsx) | [`src/shell/AuthHeader.tsx.md`](src/shell/AuthHeader.tsx.md) |
| [`src/shell/Logo.tsx`](../src/shell/Logo.tsx) | [`src/shell/Logo.tsx.md`](src/shell/Logo.tsx.md) |
| [`src/shell/Icon.tsx`](../src/shell/Icon.tsx) | [`src/shell/Icon.tsx.md`](src/shell/Icon.tsx.md) |
| [`src/shell/Alert.tsx`](../src/shell/Alert.tsx) | [`src/shell/Alert.tsx.md`](src/shell/Alert.tsx.md) |
| [`src/i18n/request.ts`](../src/i18n/request.ts) | [`src/i18n/request.ts.md`](src/i18n/request.ts.md) |
| [`src/lib/health.ts`](../src/lib/health.ts) | [`src/lib/health.ts.md`](src/lib/health.ts.md) |
| [`src/lib/api.ts`](../src/lib/api.ts) | [`src/lib/api.ts.md`](src/lib/api.ts.md) |
| [`src/lib/session.ts`](../src/lib/session.ts) | [`src/lib/session.ts.md`](src/lib/session.ts.md) |
| [`src/lib/user.ts`](../src/lib/user.ts) | [`src/lib/user.ts.md`](src/lib/user.ts.md) |
| [`messages/en.json`](../messages/en.json) | [`messages/en.json.md`](messages/en.json.md) |
| [`tests/health.test.ts`](../tests/health.test.ts) | [`tests/health.test.ts.md`](tests/health.test.ts.md) |
| [`tests/health.integration.test.ts`](../tests/health.integration.test.ts) | [`tests/health.integration.test.ts.md`](tests/health.integration.test.ts.md) |
| [`tests/health-probe.integration.test.ts`](../tests/health-probe.integration.test.ts) | [`tests/health-probe.integration.test.ts.md`](tests/health-probe.integration.test.ts.md) |
| [`tests/session.test.ts`](../tests/session.test.ts) | [`tests/session.test.ts.md`](tests/session.test.ts.md) |
| [`tests/user.test.ts`](../tests/user.test.ts) | [`tests/user.test.ts.md`](tests/user.test.ts.md) |
| [`tests/SessionProvider.test.ts`](../tests/SessionProvider.test.ts) | [`tests/SessionProvider.test.ts.md`](tests/SessionProvider.test.ts.md) |
| [`tests/testApi.test.ts`](../tests/testApi.test.ts) | [`tests/testApi.test.ts.md`](tests/testApi.test.ts.md) — unit checks of the browser-test API setup |
| [`tests/SiteHeader.test.ts`](../tests/SiteHeader.test.ts) | [`tests/SiteHeader.test.ts.md`](tests/SiteHeader.test.ts.md) |
| [`tests/SignInForm.test.ts`](../tests/SignInForm.test.ts) | [`tests/SignInForm.test.ts.md`](tests/SignInForm.test.ts.md) |
| [`tests/RegistrationForm.test.ts`](../tests/RegistrationForm.test.ts) | [`tests/RegistrationForm.test.ts.md`](tests/RegistrationForm.test.ts.md) |
| [`tests/AccountSummary.test.ts`](../tests/AccountSummary.test.ts) | [`tests/AccountSummary.test.ts.md`](tests/AccountSummary.test.ts.md) |
| [`tests/renderWithSession.ts`](../tests/renderWithSession.ts) | [`tests/renderWithSession.ts.md`](tests/renderWithSession.ts.md) — shared mounted-test helper, not a test file |
| [`tests/fakeApi.ts`](../tests/fakeApi.ts) | [`tests/fakeApi.ts.md`](tests/fakeApi.ts.md) — shared API, lock and promise fakes, not a test file |
| [`tests/browser/journey.spec.ts`](../tests/browser/journey.spec.ts) | [`tests/browser/journey.spec.ts.md`](tests/browser/journey.spec.ts.md) |
| [`tests/browser/privacy.spec.ts`](../tests/browser/privacy.spec.ts) | [`tests/browser/privacy.spec.ts.md`](tests/browser/privacy.spec.ts.md) |
| [`tests/browser/matrix.spec.ts`](../tests/browser/matrix.spec.ts) | [`tests/browser/matrix.spec.ts.md`](tests/browser/matrix.spec.ts.md) |
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
| [`.gitignore`](../.gitignore) | [`.gitignore.md`](.gitignore.md) |

## Commands and environment

The package requires Node.js `>=24.15.0 <25` and npm `11.19.0`, and pins Next.js `16.3.6`; the [manifest page](package.json.md) records the security-update rationale. From `frontend/`, use `npm ci` to install the locked dependency graph. `npm run verify` runs linting, strict TypeScript checking, unit tests, and the production build. The full `npm run test:integration` suite and `npm run probe` require a running backend URL in `MEDI_WISH_API_URL`; the focused CLI process test can run without the backend using `npx vitest run --project integration tests/health-probe.integration.test.ts`. The probe otherwise targets `http://127.0.0.1:8080`.

Unit tests use injected or stubbed fetch functions, the shared `tests/fakeApi.ts` routes and injected session sources, so they do not require a server. They cover the registration and profile calls, the memory-only session lifecycle (restore `204`/`401`/other failures, refreshing before a request without a token, the single retry, sign-out races), the cross-tab lock, the 10-second timeouts and error-code copy. Mounted jsdom tests render the session provider, store header, sign-in and registration forms and account summary through `tests/renderWithSession.ts` with a mocked router, several with a real session client over the fake API; they cover restore and redirect rules, the `/account` loading, profile, expiry and error states, the sign-out retry, POST form defaults, busy and password-clearing behavior, bounded alerts, focused notices, and keeping the access token and registration details out of URLs. `tests/testApi.test.ts` unit-tests the browser-test setup itself: the filtered environment, the occupied-port refusal and cleanup after a failed start. `npm run test:browser` builds the frontend for the test API and runs the Playwright journey, privacy and matrix specs on the installed Chrome and Edge; the [test API page](tests/browser/testApi.ts.md) lists its database settings and the command that runs `test:integration` and `probe` against the same API. On 2026-09-27, on `b26f0c9` plus the Ticket 03.03 changes, `npm run verify` passed: lint, typecheck, `npm run test:unit` (9 files, 125 tests) and `npm run build`, which produced static `/`, `/account`, `/register`, `/sign-in` and `/icon.svg`. `test:integration` (2 files, 3 tests), `probe` and `test:browser` (14 tests on Chrome and Edge) passed against the test API; Chrome 154.0.8037.57 and Edge 154.0.4258.37. The integration suite includes a live-backend test that fails with a setup message when its URL is absent and the health-probe CLI test that uses its own controlled local fixture.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior.
