# `tests/health.integration.test.ts`

Source: [`../../tests/health.integration.test.ts`](../../tests/health.integration.test.ts)

## Purpose

This test checks the frontend health consumer against the actual running backend, closing the boundary that unit mocks cannot cover.

## Case covered

The `story 01` test reads `MEDI_WISH_API_URL`, fails with an actionable setup error when it is missing, calls `probeHealth`, and requires both public liveness and readiness states to be `up`. It therefore checks URL wiring, network behavior, endpoint paths, response parsing, and the backend’s minimal health contract together.

The test does not use development credentials and does not mutate data. It should point at the dedicated test backend/database when run in an environment with a live service.

## Verification

Start the backend, set `MEDI_WISH_API_URL` to its base URL, and run `npm run test:integration` from `frontend/`. Vitest assigns this file to the `integration` project based on its filename. The normal `npm run test` command intentionally runs unit tests only.
