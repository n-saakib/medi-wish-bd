# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell and `src/app/page.tsx` as the initial storefront page. `src/i18n/request.ts` supplies the English `next-intl` messages used by both server components. `src/lib/health.ts` is the small API health boundary used by the unit tests, the real-backend integration test, and `tools/health-probe.ts`; a controlled-fixture integration test exercises the CLI process and exit-code contract.

The application renders a preparation message plus the User access panel. The panel keeps registration, sign-in and sign-out busy/feedback state independent, clears submitted passwords and stale feedback on edit or successful sign-in, suppresses restore failures during login or after sign-in, reports restore failures or an expired in-memory session accessibly, ends the restore-busy state when a profile is established, survives React Strict Mode restore-effect replay, and uses POST form defaults so pre-hydration submission cannot put credentials in the URL. Sign-out moves focus to its success status or populated error alert. The session client accepts positive-integer access-token lifetimes without an arbitrary one-day ceiling, refuses off-origin Bearer requests before each fetch attempt, preserves request bodies across its single refresh retry, and serializes sign-in, refresh and logout cookie mutations across same-origin tabs with the browser Web Locks API when available; unsupported browsers retain only per-client serialization. Product, cart, order, staff, OTP, MFA, recovery and OAuth features remain intentionally absent from this slice.

If an authenticated request still returns `401` after its one refresh retry, the session client clears the rejected in-memory access token and invalidates stale request results without canceling a newer queued sign-in.

The session client unit suite proves that sign-in, refresh and logout operations share one exclusive same-origin Web Lock (including CSRF bootstrap and response completion), concurrent expired authenticated requests share one in-flight refresh, and each original protected request is retried at most once; this client-seam test does not complete the mounted browser/API retry journey. Shared auth/profile JSON parsing is streamed with a 16 KiB byte ceiling and cancels oversized bodies independently of `Content-Length`.

## Architecture maps

| Map | Documentation |
| --- | --- |
| Frontend code architecture | [`code-architecture.md`](code-architecture.md) |

## Source mirror

| Project file | Documentation |
| --- | --- |
| [`src/app/globals.css`](../src/app/globals.css) | [`src/app/globals.css.md`](src/app/globals.css.md) — responsive account-grid tracks are capped by the available width |
| [`src/app/layout.tsx`](../src/app/layout.tsx) | [`src/app/layout.tsx.md`](src/app/layout.tsx.md) |
| [`src/app/page.tsx`](../src/app/page.tsx) | [`src/app/page.tsx.md`](src/app/page.tsx.md) |
| [`src/app/UserAccessPanel.tsx`](../src/app/UserAccessPanel.tsx) | [`src/app/UserAccessPanel.tsx.md`](src/app/UserAccessPanel.tsx.md) |
| [`src/i18n/request.ts`](../src/i18n/request.ts) | [`src/i18n/request.ts.md`](src/i18n/request.ts.md) |
| [`src/lib/health.ts`](../src/lib/health.ts) | [`src/lib/health.ts.md`](src/lib/health.ts.md) |
| [`src/lib/session.ts`](../src/lib/session.ts) | [`src/lib/session.ts.md`](src/lib/session.ts.md) |
| [`src/lib/user.ts`](../src/lib/user.ts) | [`src/lib/user.ts.md`](src/lib/user.ts.md) |
| [`messages/en.json`](../messages/en.json) | [`messages/en.json.md`](messages/en.json.md) |
| [`tests/health.test.ts`](../tests/health.test.ts) | [`tests/health.test.ts.md`](tests/health.test.ts.md) |
| [`tests/health.integration.test.ts`](../tests/health.integration.test.ts) | [`tests/health.integration.test.ts.md`](tests/health.integration.test.ts.md) |
| [`tests/health-probe.integration.test.ts`](../tests/health-probe.integration.test.ts) | [`tests/health-probe.integration.test.ts.md`](tests/health-probe.integration.test.ts.md) |
| [`tests/session.test.ts`](../tests/session.test.ts) | [`tests/session.test.ts.md`](tests/session.test.ts.md) |
| [`tests/UserAccessPanel.test.ts`](../tests/UserAccessPanel.test.ts) | [`tests/UserAccessPanel.test.ts.md`](tests/UserAccessPanel.test.ts.md) |
| [`tests/user.test.ts`](../tests/user.test.ts) | [`tests/user.test.ts.md`](tests/user.test.ts.md) |
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

Unit tests use injected fetch functions, so they do not require a server. They cover registration/profile boundaries, the memory-only session lifecycle including positive-integer lifetime validation, same-origin Bearer request/retry checks, serialized cookie mutations, rejection of stale protected responses after refresh failure, invalidated refresh/sign-in results, accessible panel markup including POST form defaults and focusable feedback targets, reducer state, and translated fallback selection. The integration suite includes a live-backend test that fails with a setup message when its URL is absent and the health-probe CLI test that uses its own controlled local fixture.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior.
