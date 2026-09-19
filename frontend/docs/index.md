# Frontend documentation

This directory mirrors the checked-in frontend source and build files. Each page documents the corresponding file’s responsibility, exported behavior, design reason, practical use, and verification path. The source remains authoritative; update the matching page in the same change whenever a documented file changes.

## Current frontend flow

Next.js loads `src/app/layout.tsx` as the document shell and `src/app/page.tsx` as the initial storefront page. `src/i18n/request.ts` supplies the English `next-intl` messages used by both server components. `src/lib/health.ts` is the small API health boundary used by the unit tests, the real-backend integration test, and `tools/health-probe.ts`.

The application renders a preparation message plus the User access panel. The panel keeps registration and sign-in busy and feedback state independent, clears submitted passwords and stale feedback on edit, and uses the Ticket 03 memory-only session seam for identifier login, restore and sign-out. Product, cart, order, staff, OTP, MFA, recovery and OAuth features remain intentionally absent from this slice.

## Architecture maps

| Map | Documentation |
| --- | --- |
| Frontend code architecture | [`code-architecture.md`](code-architecture.md) |

## Source mirror

| Project file | Documentation |
| --- | --- |
| [`src/app/globals.css`](../src/app/globals.css) | [`src/app/globals.css.md`](src/app/globals.css.md) |
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

The package requires Node.js `>=24.0.0 <25` and npm `11.19.0`. From `frontend/`, use `npm ci` to install the locked dependency graph. `npm run verify` runs linting, strict TypeScript checking, unit tests, and the production build. `npm run test:integration` and `npm run probe` require a running backend URL in `MEDI_WISH_API_URL`; the probe otherwise targets `http://127.0.0.1:8080`.

Unit tests use injected fetch and cookie functions, so they do not require a server. They cover registration/profile boundaries, the memory-only session lifecycle, accessibility markup and translated fallback selection. The integration test deliberately calls the real backend and fails with a setup message when the URL is absent.

## Documentation maintenance

When a frontend file is added, add its mirrored `.md` page and one row to the table above. When a function, component, configuration export, message key, or test case changes, update its entry in the matching page. Keep explanations tied to observable behavior and current product scope; do not document planned features as implemented behavior.
