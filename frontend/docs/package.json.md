# `package.json`

Source: [`../package.json`](../package.json)

## Purpose

This manifest defines the frontend package identity, supported runtime, dependency versions, and the small set of commands used for development and verification. Exact dependency pins make the current build reproducible; `package-lock.json` records the resolved graph.

## Runtime and dependencies

- The private package is `medi-wish-frontend` at version `0.1.0`.
- `engines` requires Node.js `>=24.0.0 <25`; `packageManager` records npm `11.19.0`.
- Runtime dependencies are Next.js `16.3.5`, React/React DOM `19.3.0`, and `next-intl` `4.14.5`.
- Development dependencies provide Next’s ESLint rules, TypeScript and React/Node types, ESLint `10.10.0`, and Vitest `5.0.1`.

The frontend uses the Next App Router with server components and request-scoped translations. No UI library, state library, payment client, or browser automation dependency is present in this foundation slice.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` | Starts Next development mode on `127.0.0.1`. |
| `build` | Creates the production Next build. |
| `start` | Serves the production build on `127.0.0.1`. |
| `lint` | Runs ESLint with zero warnings allowed. |
| `typecheck` | Runs strict TypeScript checking without emitting files. |
| `test` / `test:unit` | Runs the Vitest unit project. |
| `test:integration` | Runs only real-backend integration tests. |
| `probe` | Runs the health CLI adapter. |
| `verify` | Runs lint, typecheck, unit tests, and production build in sequence. |

## Use and verification

Use `npm ci` from `frontend/` for a clean lockfile installation, then `npm run verify` before handing off frontend changes. Set `MEDI_WISH_API_URL` only for integration tests or the health probe; it is not needed for the unit suite or build.
