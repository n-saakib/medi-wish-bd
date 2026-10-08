# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell. It mounts the `next-intl` provider and one `SessionProvider` around three route groups that add no URL segment: `(store)` holds home/account, `(auth)` holds sign-in, registration and MFA, and `(staff)` holds the verified staff landing and Ticket 14 Products and Categories pages. `src/i18n/request.ts` supplies English messages. Feature code is grouped under `src/auth/`, `src/account/`, `src/staff/`, `src/catalog/` and `src/shell/`. `src/lib/api.ts` is the shared HTTP boundary under the session, user, staff and catalog clients. `src/lib/health.ts` is the API health boundary used by unit and integration checks.

Every route is statically generated. The access token stays memory-only in `src/lib/session.ts` and the refresh credential is an HttpOnly cookie on the API origin, so the signed-in state is known only in the browser: the provider restores the session once per page load, and `sessionRedirect` holds every redirect until that restore finishes. A refresh `204` means no session and a `401` an expired one, which the sign-in page announces. `/account` sends signed-out visitors to `/sign-in`, but to `/` right after a sign-out, and stays put while sign-out is pending; `/sign-in` and `/register` send a signed-in user to the page for the session's MFA status: `/account` when no MFA is required, `/staff/mfa/enroll` when an authenticator must be set up, `/staff/mfa` when a code is required and `/staff` once verified. The staff pages admit only their own status, send other sessions to that page, and send signed-out visitors to `/sign-in`; `/account` also admits a verified staff session. The store header shows no account link until the restore finishes, then either `Sign in` or the username.

Sign-in and registration keep credentials out of URLs and show bounded error copy; account and MFA continue through the shared session provider. The staff catalog pages load only after MFA verification and use authenticated requests. Admin and Moderator may manage catalog fields and categories; only Admin sees editable Product pricing. The Products page filters and pages summaries with right-aligned numeric money columns; both list pagers use actual returned rows and provide truthful empty-page states with Previous navigation; the editor separates catalog and pricing commands, disables both forms during either save to protect submitted drafts, keeps existing inactive category assignments, handles stale versions and shows change history. The Categories page manages names and active status inline, guards its editor during saves, and replaces outdated rows and paging with loading while the post-save page reloads. Unset amounts use “Not set”; filter and history copy distinguish price requirements and review-flag direction. Catalog grids shrink around maximum-length category options, and table headings anchor their accessible hidden labels so tables scroll within the card at 375 px. Each page's mirror describes its behavior and design details.

The session client keeps the access token in memory, refuses off-origin Bearer requests, refreshes and retries one `401`, and serializes cookie mutations. Every API call has a 10-second bound. Restricted Admin and Moderator sessions verify MFA before `/staff` or its catalog routes. Catalog responses project each field and validate required values by history action before rendering, keeping money as decimal strings; a 256 KiB success-body bound accommodates the largest permitted page while error bodies keep the normal 16 KiB bound. Cart, orders, OTP and recovery remain outside this slice.

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
| [`src/app/(staff)/staff/products/page.tsx`](../src/app/(staff)/staff/products/page.tsx) | [`src/app/(staff)/staff/products/page.tsx.md`](src/app/(staff)/staff/products/page.tsx.md) |
| [`src/app/(staff)/staff/products/new/page.tsx`](../src/app/(staff)/staff/products/new/page.tsx) | [`src/app/(staff)/staff/products/new/page.tsx.md`](src/app/(staff)/staff/products/new/page.tsx.md) |
| [`src/app/(staff)/staff/products/[productId]/page.tsx`](../src/app/(staff)/staff/products/[productId]/page.tsx) | [`src/app/(staff)/staff/products/[productId]/page.tsx.md`](src/app/(staff)/staff/products/[productId]/page.tsx.md) |
| [`src/app/(staff)/staff/categories/page.tsx`](../src/app/(staff)/staff/categories/page.tsx) | [`src/app/(staff)/staff/categories/page.tsx.md`](src/app/(staff)/staff/categories/page.tsx.md) |
| [`src/catalog/ProductList.tsx`](../src/catalog/ProductList.tsx) | [`src/catalog/ProductList.tsx.md`](src/catalog/ProductList.tsx.md) |
| [`src/catalog/ProductEditor.tsx`](../src/catalog/ProductEditor.tsx) | [`src/catalog/ProductEditor.tsx.md`](src/catalog/ProductEditor.tsx.md) — distinct catalog/pricing forms with validated error recovery and preserved catalog drafts |
| [`src/catalog/CategoryManager.tsx`](../src/catalog/CategoryManager.tsx) | [`src/catalog/CategoryManager.tsx.md`](src/catalog/CategoryManager.tsx.md) |
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
| [`src/lib/catalog.ts`](../src/lib/catalog.ts) | [`src/lib/catalog.ts.md`](src/lib/catalog.ts.md) |
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
| [`tests/catalog.test.ts`](../tests/catalog.test.ts) | [`tests/catalog.test.ts.md`](tests/catalog.test.ts.md) |
| [`tests/catalogPages.test.ts`](../tests/catalogPages.test.ts) | [`tests/catalogPages.test.ts.md`](tests/catalogPages.test.ts.md) |
| [`tests/renderWithSession.ts`](../tests/renderWithSession.ts) | [`tests/renderWithSession.ts.md`](tests/renderWithSession.ts.md) — shared mounted-test helper, not a test file |
| [`tests/fakeApi.ts`](../tests/fakeApi.ts) | [`tests/fakeApi.ts.md`](tests/fakeApi.ts.md) — shared API, lock and promise fakes, not a test file |
| [`tests/catalogSupport.test.ts`](../tests/catalogSupport.test.ts) | [`tests/catalogSupport.test.ts.md`](tests/catalogSupport.test.ts.md) — unit checks of the catalog specs' token renewal and staff-context cleanup |
| [`tests/browser/catalogDatabase.spec.ts`](../tests/browser/catalogDatabase.spec.ts) | [`tests/browser/catalogDatabase.spec.ts.md`](tests/browser/catalogDatabase.spec.ts.md) |
| [`tests/browser/catalogApi.spec.ts`](../tests/browser/catalogApi.spec.ts) | [`tests/browser/catalogApi.spec.ts.md`](tests/browser/catalogApi.spec.ts.md) |
| [`tests/browser/catalogUi.spec.ts`](../tests/browser/catalogUi.spec.ts) | [`tests/browser/catalogUi.spec.ts.md`](tests/browser/catalogUi.spec.ts.md) |
| [`tests/browser/catalogSupport.ts`](../tests/browser/catalogSupport.ts) | [`tests/browser/catalogSupport.ts.md`](tests/browser/catalogSupport.ts.md) — shared catalog-spec helpers and contract strings, not a spec |
| [`tests/browser/journey.spec.ts`](../tests/browser/journey.spec.ts) | [`tests/browser/journey.spec.ts.md`](tests/browser/journey.spec.ts.md) |
| [`tests/browser/privacy.spec.ts`](../tests/browser/privacy.spec.ts) | [`tests/browser/privacy.spec.ts.md`](tests/browser/privacy.spec.ts.md) |
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
| [`.gitignore`](../.gitignore) | [`.gitignore.md`](.gitignore.md) |

## Commands and environment

The package requires Node.js `>=24.15.0 <25` and npm `11.19.0`, and pins Next.js `16.3.6`; the [manifest page](package.json.md) records the security-update rationale. From `frontend/`, use `npm ci` to install the locked dependency graph. `npm run verify` runs linting, strict TypeScript checking, unit tests, and the production build. The full `npm run test:integration` suite and `npm run probe` require a running backend URL in `MEDI_WISH_API_URL`; the focused CLI process test can run without the backend using `npx vitest run --project integration tests/health-probe.integration.test.ts`. The probe otherwise targets `http://127.0.0.1:8080`.

Unit tests use injected or stubbed fetch functions, the shared `tests/fakeApi.ts` routes and injected session sources, so they do not require a server. They cover the registration and profile calls, the memory-only session lifecycle (restore `204`/`401`/other failures, refreshing before a request without a token, the single retry, sign-out races), the cross-tab lock, the 10-second timeouts and error-code copy. Mounted jsdom tests render the session provider, store and staff headers, sign-in and registration forms, account summary, authenticator setup and code pages, backup codes and staff landing through `tests/renderWithSession.ts` with a mocked router, several with a real session client over the fake API; they cover restore and redirect rules, the `/account` loading, profile, expiry and error states, the sign-out retry, POST form defaults, busy and password-clearing behavior, bounded alerts, focused notices, and keeping the access token and registration details out of URLs; the MFA tests cover the full status-by-guard redirect table, only the latest setup being shown, stale, invalid and locked codes, clearing secrets on `pagehide` and unmount, and keeping secrets and backup codes out of storage, URLs and the console. Catalog tests cover strict response projections and decimal-string formatting, mounted catalog/pricing forms and dependent error recovery, preserved unsaved drafts, pending-save and post-save loading behavior, and exact list/history copy. The catalog browser specs exercise real API/database contracts, role journeys, paging, keyboard controls and mobile scrolling; helper units cover token renewal and failed staff-context cleanup. The MFA privacy journey waits for the signed-in destination link before back navigation, preserving its secret, storage and no-store assertions. `tests/testApi.test.ts` unit-tests the browser-test setup itself: the filtered environment, the run's own MFA key, the occupied-port refusal, cleanup after a failed start and the `grantRole` guards; `tests/totp.test.ts` checks the test authenticator against the RFC 6238 vectors. `npm run test:browser` builds the frontend for the test API and runs the Playwright journey, privacy, matrix, staff MFA and catalog specs on the installed Chrome and Edge (`--grep @smoke` runs only the Admin enrollment smoke path); the [test API page](tests/browser/testApi.ts.md) lists its database settings and the command that runs `test:integration` and `probe` against the same API. On 2026-09-27, on the working tree over revision `bef3b76` with the staff MFA changes, `npm run verify` passed: lint, typecheck, `npm run test:unit` (14 files, 255 tests) and `npm run build`, which produced static `/`, `/account`, `/register`, `/sign-in`, `/staff`, `/staff/mfa`, `/staff/mfa/enroll` and `/icon.svg`. Against the test API started by `tests/browser/testApi.ts` (PostgreSQL 18 on `127.0.0.1:55432`, backend jar built with `./mvnw.cmd -o -q package -DskipTests`), `npm run test:integration` (3 files, 4 tests) and `npm run probe` (`{"liveness":"up","readiness":"up"}`) passed, and `npm run test:browser` passed 22 tests (11 per channel) on Chrome 154.0.8037.57 and Edge 154.0.4258.37; `npx playwright test --grep @smoke` passed 2. The test API's teardown left no run role and freed ports 18080 and 3100. The integration suite includes a live-backend test that fails with a setup message when its URL is absent and the health-probe CLI test that uses its own controlled local fixture.

**Ticket acceptance tests.** End-to-end tests written ahead of a ticket are named `E2E-<ticket>-<nn> <title>` and tagged `{ tag: ['@t<ticket>', '@t<ticket>-T<n>'] }`, with exactly one sub-ticket tag: the sub-ticket whose completion first makes the test pass. A sub-ticket's gate is `npm run test:browser -- --grep @t<ticket>-T<n>` plus every earlier gate of that ticket, and `--grep @t<ticket>` runs the whole ticket. Run one browser run at a time, because the test API and the frontend use fixed ports 18080 and 3100. A ticket's smoke path also carries `@smoke`. Tests that need two tickets are tagged `@cross-<a>-<b>` and are added by whichever of the two merges second. Each spec's page lists its IDs and whether they have run; the ID tables and gates are in §10 of each ticket's implementation plan. `testApi.ts` and `support.ts` are shared by these tickets: change them identically on every open ticket branch, or after the others merge.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior. Ticket 14's dated evidence records verification commands, results and candidate identity.

Product and category create retries retain one UUID after an uncertain response. An edited retry conflicts without duplication; generic error copy and explicit Reload recover the attempted Product or current category list while preserving the draft until chosen. Stateful mounted tests cover identical and edited committed-but-lost responses.

E2E-14-44 scopes the access-denied alert to the Product editor's main landmark, excluding the Next.js route announcer. The 2026-10-07 cumulative run passed 122/124 checks; the two failures were this locator ambiguity. The corrected cumulative rerun remains pending.

Final Ticket14 verification on2026-10-07, HEAD `8b6924c` plus working changes:346units across17files, lint, types and production build passed after the E2E-14-44 locator correction. Full cumulative Chrome/Edge browser verification passed124/124 in7.0minutes (`final-full-browser-retry-20261007.log`); live integration passed5/5 and probe reported liveness/readiness up. The first final run's122/124 ambiguous-alert failures remain recorded; the assertion now scopes to the editor's main landmark. Final manual built-in-browser accessibility/demo screenshots remain environment-blocked and are not claimed complete. Main-checkout Ticket14 dated evidence records exact commands, candidate identity and the separate smoke result.

Ticket 14 review correction (2026-10-07): ProductList, ProductEditor and CategoryManager use the static design status/Review chip tones from globals.css. Mounted catalogPages regressions cover all states and catalogUi retains text plus computed-color assertions. Focused catalogPages tests passed 43/43 after recorded red baselines (3 list failures; 5 editor/category failures). Full npm run verify passed lint, types, 354 units across 17 files and the production build with VITEST_MAX_WORKERS=1 and the default API environment; logs: main checkout .scratch/ticket14-verification/review-chip-all-green.log and review-chip-frontend-verify.log. Actual browser execution is recorded separately by the integration owner.

Corrected-candidate cumulative verification, continued2026-10-08: all124 Chrome/Edge browser checks passed in9.2minutes and four separate smoke checks passed in57.8seconds, including computed Active/Needs price/Inactive/Review colour assertions. The same frozen source passed354 units/lint/types/build; current live integration passed5/5 at04:38:16 Asia/Dhaka and probe reported liveness/readiness up. Logs are main .scratch/ticket14-verification/review-fixes-full-browser-20261007.log, review-fixes-smoke-browser-20261007.log, review-fixes-live-integration-20261008.log and review-fixes-live-probe-20261008.log. Matching main Ticket14 evidence/2026-10-08.md records source/jar parity and released disposable resources. Manual accessibility/demo screenshots remain unverified because fresh browser-helper startup attempts still terminate its kernel; automated checks do not close that gate.

Ticket 14 completion corrections restore shared helper documentation parity, exact generic error messages, truthful empty-page ranges and design money alignment; current verification is recorded in the main ticket evidence.
