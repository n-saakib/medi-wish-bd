# `tests/health-probe.integration.test.ts`

Source: [`../../tests/health-probe.integration.test.ts`](../../tests/health-probe.integration.test.ts)

## Purpose

This test exercises the health-probe command boundary by launching the real `tools/health-probe.ts` in a child Node process against a temporary local HTTP fixture. It needs no backend service, credentials, or additional package.

## Cases covered

- **Healthy endpoints:** the fixture returns HTTP 200 with `UP` for both liveness and readiness; the test checks both paths, exit code `0`, and normalized JSON output.
- **Degraded readiness:** the fixture returns HTTP 200/`UP` for liveness and HTTP 503/`OUT_OF_SERVICE` for readiness; the test checks both paths, exit code `1`, and normalized `up`/`down` JSON output.

The child uses the current Node executable and inherits the test process environment with `MEDI_WISH_API_URL` overridden to the fixture URL. The server binds to loopback on an ephemeral port and is closed after each case.

## Verification

Run from `frontend/` with `npx vitest run --project integration tests/health-probe.integration.test.ts`. This focused test is independent of the backend; the broader integration suite also contains a live-backend test.
