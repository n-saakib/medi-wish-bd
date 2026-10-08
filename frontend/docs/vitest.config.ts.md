# `vitest.config.ts`

Source: [`../vitest.config.ts`](../vitest.config.ts)

## Purpose

This file separates fast deterministic unit tests from tests that require a running backend while keeping one Vitest command surface.

## Configuration

`defineConfig` declares two projects:

- `unit` includes `tests/**/*.test.ts` and excludes files ending in `tests/**/*.integration.test.ts`.
- `integration` includes only `tests/**/*.integration.test.ts`.

The naming convention makes test intent visible in the file name and prevents a normal unit run from unexpectedly calling a live service. The integration project is intentionally lightweight because the current frontend integration boundary is the real health endpoint.

## Use and verification

`npm run test:unit` runs the unit project; `npm run test:integration` runs the integration project. `npm test` aliases the unit command, while `npm run verify` includes unit tests and therefore remains safe without a running backend.

Ticket 11 extends unit discovery to tests/**/*.test.{ts,tsx}, so JSX-based profile form tests run in the normal unit and verify commands. Integration files remain excluded from the unit project.
