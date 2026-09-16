# `tools/health-probe.ts`

Source: [`../../tools/health-probe.ts`](../../tools/health-probe.ts)

## Purpose

This is the command-line adapter for the reusable `probeHealth` function. It gives local development, CI, and deployment checks a process exit code without duplicating HTTP or response-validation logic.

## Behavior

The script reads `MEDI_WISH_API_URL`, defaulting to `http://127.0.0.1:8080` for the standard local backend. It awaits `probeHealth`, prints only the compact JSON result, and sets `process.exitCode` to `0` only when both liveness and readiness are `up`; every other state returns `1`.

Keeping the output to the two normalized states makes the command safe to consume in logs and automation. Detailed backend diagnostics remain behind the backend’s own protected operational surfaces.

## Use cases and verification

Use `npm run probe` while the backend is running locally or in a deployment health step. The health unit tests verify the imported function; the integration test verifies the same function against a real backend. A shell-level probe check should confirm the exit code in environments that execute the tool.
