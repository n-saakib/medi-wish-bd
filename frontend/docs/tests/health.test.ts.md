# `tests/health.test.ts`

Source: [`../../tests/health.test.ts`](../../tests/health.test.ts)

## Purpose

These unit tests define the public contract of `probeHealth` without requiring a running backend. Each test supplies an injected fetch implementation, which keeps failures deterministic and lets the module’s timeout and response-shape decisions be checked directly.

## Cases covered

- **Healthy API:** two public `UP` responses produce `liveness: 'up'` and `readiness: 'up'`.
- **Independent readiness failure:** liveness remains `up` while a `503`/`DOWN` readiness response becomes `down`.
- **Connection failure:** a rejected fetch becomes `unavailable` for both groups and does not leak the simulated internal error.
- **Timeout:** a deliberately slow fetch is aborted using the configured 20 ms timeout and produces `unavailable` states.
- **Invalid or unsafe responses:** a table-driven `it.each` covers invalid JSON, an `UP` body with the wrong HTTP status, an unknown status, and extra diagnostic fields. Every case becomes `invalid-response` without copying backend details.

The tests therefore protect both operational behavior and the health endpoint’s information-minimization boundary. They do not test the backend’s database or actuator implementation; that belongs to backend integration tests.

## Verification

Run from `frontend/` with `npm run test:unit`. The Vitest configuration includes this file in the `unit` project and excludes files whose names end in `.integration.test.ts`.
