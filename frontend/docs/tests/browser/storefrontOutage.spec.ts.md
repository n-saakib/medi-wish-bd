# `tests/browser/storefrontOutage.spec.ts`

Source: [`../../../tests/browser/storefrontOutage.spec.ts`](../../../tests/browser/storefrontOutage.spec.ts)

Ticket 17 T6 API-outage check, **E2E-17-21** (E3, V-5, V-9). The file runs serially. Its `beforeAll` first refuses to start if anything already listens on `127.0.0.1:3116`. It then spawns `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3116` in `frontend/`, using the `.next` production build the main webServer already made, with `MEDI_WISH_SERVER_API_URL=http://127.0.0.1:9` (a closed port), `MEDI_WISH_SITE_URL=http://127.0.0.1:3116` and the rest of `process.env`. It polls `GET /` for up to 60 s (90 s hook timeout) and fails at once, with the last 8 KiB of server output, if the child exits early. `afterAll` kills only the spawned pid's process tree (`taskkill /pid <pid> /T /F` on Windows, `process.kill` elsewhere) and asserts that port 3116 is free again.

| Test | What it proves |
| --- | --- |
| E2E-17-21 `/categories`, a category page, a details page | Status ≥ 500, with the "This page couldn’t load" heading, the "Please try again in a moment." text and the **Try again** button. There is no not-found heading, no empty state and no "No categories yet", and the page shows no digest or connection error text. |
| E2E-17-21 home page | `/` answers 200 with no `Categories` nav and no Categories section (P10). |
| E2E-17-21 correlated category `NOT_FOUND` | Restarts the owned production Next server against an ephemeral loopback HTTP adapter returning HTTP 404 with matching UUID `X-Request-ID` and body `requestId` plus `code: NOT_FOUND`. Proves `/categories` reaches that adapter and answers ≥ 500 with the retryable error UI, never not-found, empty state or "No categories yet". The page exposes neither API code, correlation ID nor internal error text. |

The final regression uses the same production build and port 3116 as the connection-outage cases. The adapter binds an operating-system-selected loopback port; suite teardown stops the owned Next process before closing the adapter, including on assertion failures. It does not modify the running backend or database.

Tags: `@t17`, `@t17-T6`, `@t17-ui`, `@regression`. Targeting: `--grep "E2E-17-21"`, or run the file alone (`npx playwright test storefrontOutage.spec.ts`, V-9 fallback).

The production storefront loaders and `(store)/error.tsx` now exist. The correlated category-collection regression covers the distinction between a missing resource and an invalid collection response; a category collection `NOT_FOUND` must take the server-error path. Actual verification results are recorded in the Ticket 17 E2E report.
