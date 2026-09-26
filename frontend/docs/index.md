# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell. It mounts the `next-intl` provider and one `SessionProvider` around two route groups that add no URL segment: `(store)` renders the store header above the home page (`/`) and the account page (`/account`), and `(auth)` renders a reduced header above the sign-in (`/sign-in`) and registration (`/register`) pages. `src/i18n/request.ts` supplies the English messages. Feature code is grouped by feature: `src/auth/` (session provider, redirect rules, sign-in and registration forms, sign-out notice), `src/account/` (account summary) and `src/shell/` (headers, logo, icons, alerts). `src/lib/health.ts` is the small API health boundary used by the unit tests, the real-backend integration test, and `tools/health-probe.ts`; a controlled-fixture integration test exercises the CLI process and exit-code contract.

Every route is statically generated. The access token stays memory-only in `src/lib/session.ts` and the refresh credential is an HttpOnly cookie on the API origin, so the signed-in state is known only in the browser: the provider restores the session once per page load, and `sessionRedirect` holds every redirect until that restore finishes. `/account` sends signed-out visitors to `/sign-in`, but to `/` right after a sign-out, and stays put while sign-out is pending; `/sign-in` and `/register` send signed-in users to `/account`. The store header shows no account link until the restore finishes, then either `Sign in` or the username.

Sign-in shows one generic alert on failure, clears the password and refocuses the identifier; session-expired, restore-failure and account-created notices appear only when they occur and receive focus. Registration omits a blank email, clears the password at submit and, on success, signs in with the same credentials (accepted decision D1); if that sign-in fails, the visitor is sent to `/sign-in` with an account-created notice and no identifiers in the URL. Sign-out ends the local session even if the server call fails, and the home page announces and focuses the result. Both forms use `method="post"` so a pre-hydration submission cannot put credentials in the URL. The pages follow `agent-docs/ui-design/` (`home.html`, `sign-in.html`, `register.html`); each page's mirror records its deliberate deviations, such as the header without search, cart or category navigation and the 12-character password hint.

The session client accepts positive-integer access-token lifetimes without an arbitrary one-day ceiling, refuses off-origin Bearer requests before each fetch attempt, preserves request bodies across its single refresh retry, and serializes sign-in, refresh and logout cookie mutations across same-origin tabs with the browser Web Locks API when available; unsupported browsers retain only per-client serialization. Product, cart, order, staff, OTP, MFA, recovery and OAuth features remain intentionally absent from this slice.

If an authenticated request still returns `401` after its one refresh retry, the session client clears the rejected in-memory access token and invalidates stale request results without canceling a newer queued sign-in.

The session client unit suite proves that sign-in, refresh and logout operations share one exclusive same-origin Web Lock (including CSRF bootstrap and response completion), concurrent expired authenticated requests share one in-flight refresh, and each original protected request is retried at most once; this client-seam test does not complete the mounted browser/API retry journey. Shared auth/profile JSON parsing is streamed with a 16 KiB byte ceiling and cancels oversized bodies independently of `Content-Length`.

## Architecture maps

| Map | Documentation |
| --- | --- |
| Frontend code architecture | [`code-architecture.md`](code-architecture.md) |

## Source mirror

| Project file | Documentation |
| --- | --- |
| [`src/app/globals.css`](../src/app/globals.css) | [`src/app/globals.css.md`](src/app/globals.css.md) — design tokens and components ported from the page designs |
| [`src/app/layout.tsx`](../src/app/layout.tsx) | [`src/app/layout.tsx.md`](src/app/layout.tsx.md) |
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
| [`src/lib/session.ts`](../src/lib/session.ts) | [`src/lib/session.ts.md`](src/lib/session.ts.md) |
| [`src/lib/user.ts`](../src/lib/user.ts) | [`src/lib/user.ts.md`](src/lib/user.ts.md) |
| [`messages/en.json`](../messages/en.json) | [`messages/en.json.md`](messages/en.json.md) |
| [`tests/health.test.ts`](../tests/health.test.ts) | [`tests/health.test.ts.md`](tests/health.test.ts.md) |
| [`tests/health.integration.test.ts`](../tests/health.integration.test.ts) | [`tests/health.integration.test.ts.md`](tests/health.integration.test.ts.md) |
| [`tests/health-probe.integration.test.ts`](../tests/health-probe.integration.test.ts) | [`tests/health-probe.integration.test.ts.md`](tests/health-probe.integration.test.ts.md) |
| [`tests/session.test.ts`](../tests/session.test.ts) | [`tests/session.test.ts.md`](tests/session.test.ts.md) |
| [`tests/user.test.ts`](../tests/user.test.ts) | [`tests/user.test.ts.md`](tests/user.test.ts.md) |
| [`tests/SessionProvider.test.ts`](../tests/SessionProvider.test.ts) | [`tests/SessionProvider.test.ts.md`](tests/SessionProvider.test.ts.md) |
| [`tests/SiteHeader.test.ts`](../tests/SiteHeader.test.ts) | [`tests/SiteHeader.test.ts.md`](tests/SiteHeader.test.ts.md) |
| [`tests/SignInForm.test.ts`](../tests/SignInForm.test.ts) | [`tests/SignInForm.test.ts.md`](tests/SignInForm.test.ts.md) |
| [`tests/RegistrationForm.test.ts`](../tests/RegistrationForm.test.ts) | [`tests/RegistrationForm.test.ts.md`](tests/RegistrationForm.test.ts.md) |
| [`tests/AccountSummary.test.ts`](../tests/AccountSummary.test.ts) | [`tests/AccountSummary.test.ts.md`](tests/AccountSummary.test.ts.md) |
| [`tests/renderWithSession.ts`](../tests/renderWithSession.ts) | [`tests/renderWithSession.ts.md`](tests/renderWithSession.ts.md) — shared mounted-test helper, not a test file |
| [`tools/health-probe.ts`](../tools/health-probe.ts) | [`tools/health-probe.ts.md`](tools/health-probe.ts.md) |
| [`package.json`](../package.json) | [`package.json.md`](package.json.md) |
| [`package-lock.json`](../package-lock.json) | [`package-lock.json.md`](package-lock.json.md) |
| [`next.config.ts`](../next.config.ts) | [`next.config.ts.md`](next.config.ts.md) |
| [`tsconfig.json`](../tsconfig.json) | [`tsconfig.json.md`](tsconfig.json.md) |
| [`vitest.config.ts`](../vitest.config.ts) | [`vitest.config.ts.md`](vitest.config.ts.md) |
| [`eslint.config.mjs`](../eslint.config.mjs) | [`eslint.config.mjs.md`](eslint.config.mjs.md) |
| [`public/.gitkeep`](../public/.gitkeep) | [`public/.gitkeep.md`](public/.gitkeep.md) |
| [`.npmrc`](../.npmrc) | [`.npmrc.md`](.npmrc.md) |
| [`.gitignore`](../.gitignore) | [`.gitignore.md`](.gitignore.md) |

## Commands and environment

The package requires Node.js `>=24.15.0 <25` and npm `11.19.0`, and pins Next.js `16.3.6`; the [manifest page](package.json.md) records the security-update rationale. From `frontend/`, use `npm ci` to install the locked dependency graph. `npm run verify` runs linting, strict TypeScript checking, unit tests, and the production build. The full `npm run test:integration` suite and `npm run probe` require a running backend URL in `MEDI_WISH_API_URL`; the focused CLI process test can run without the backend using `npx vitest run --project integration tests/health-probe.integration.test.ts`. The probe otherwise targets `http://127.0.0.1:8080`.

Unit tests use injected or stubbed fetch functions and injected session sources, so they do not require a server. They cover registration/profile boundaries, the memory-only session lifecycle including positive-integer lifetime validation, same-origin Bearer request/retry checks, serialized cookie mutations, rejection of stale protected responses after refresh failure, invalidated refresh/sign-in results, and translated fallback selection. Mounted jsdom tests render the session provider, store header, sign-in and registration forms and account summary through `tests/renderWithSession.ts` with a mocked router; they cover restore and redirect rules, POST form defaults, busy and password-clearing behavior, bounded alerts, focused notices, and keeping the access token and registration details out of URLs. On 2026-09-26 `npm run typecheck`, `npm run lint` and `npm run test:unit` (8 files, 92 tests) passed, and `npm run build` produced static `/`, `/account`, `/register` and `/sign-in`; browser verification is recorded in the Ticket 03.01 evidence. The integration suite includes a live-backend test that fails with a setup message when its URL is absent and the health-probe CLI test that uses its own controlled local fixture.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior.
