# `src/lib/health.ts`

Source: [`../../../src/lib/health.ts`](../../../src/lib/health.ts)

## Purpose

This module is the frontend’s small, safe boundary for backend liveness and readiness checks. It converts two public actuator responses into a stable result that a probe, test, or future status view can consume without seeing backend diagnostics.

## Types

### `HealthState`

The union `'up' | 'down' | 'unavailable' | 'invalid-response'` distinguishes a healthy endpoint, a recognized dependency/process failure, a connection or timeout failure, and a malformed or unexpected public response.

### `HealthResult`

The result has independent `liveness` and `readiness` states. Keeping them separate lets callers report that the process is alive while a dependency such as PostgreSQL is unavailable.

### `ProbeOptions`

The internal options type accepts an optional fetch implementation and timeout. Injected fetch is a test seam; the production default remains `globalThis.fetch`. The type is not exported because callers only need the public probe function.

## Export

### `probeHealth(baseUrl, options = {}): Promise<HealthResult>`

For each health group, the function:

1. Builds `/actuator/health/liveness` or `/actuator/health/readiness` relative to `baseUrl`.
2. Uses the supplied or global fetcher with `AbortSignal.timeout`, defaulting to three seconds.
3. Disables caching and rejects redirects so a status check reflects the current backend and does not silently follow an unexpected destination.
4. Parses the response as unknown data and accepts only the exact public shape `{ "status": ... }`. A `200` with `UP` becomes `up`; a `503` with `DOWN` or `OUT_OF_SERVICE` becomes `down`.
5. Returns `invalid-response` for malformed JSON, unexpected HTTP/status combinations, or extra diagnostic fields. Other exceptions, including connection failures and aborts, become `unavailable` without copying the error into the result.

Both checks run with `Promise.all`, so total latency is bounded by the slower check rather than the sum of both requests. The function returns the pair as `{ liveness, readiness }`.

### Internal `check(group)`

The nested helper performs the complete request, parsing, status mapping, and exception classification for one health group. Keeping this logic private prevents callers from bypassing the shared response contract while allowing liveness and readiness to use identical rules.

## Use cases and safety boundary

The module supports local probes, CI/deployment checks, and a future non-sensitive status indicator. It intentionally consumes only the backend’s public status contract and never exposes component details, credentials, exception text, or response bodies to callers.

## Verification

[`tests/health.test.ts`](../../tests/health.test.ts.md) covers recognized statuses, independent readiness failure, network failure, timeout cancellation, malformed JSON, wrong status codes, unknown statuses, and diagnostic-field rejection. [`tests/health.integration.test.ts`](../../tests/health.integration.test.ts.md) checks the real backend contract when configured.
