# `playwright.config.ts`

Source: [`../playwright.config.ts`](../playwright.config.ts)

## Purpose

Runs the browser specs in `tests/browser/` on the installed stable Chrome (`chrome` project) and Edge (`msedge` project) against the locked test environment of Ticket 03.02: the built frontend on `127.0.0.1:3115` and the test API on `127.0.0.1:18115` (`frontendUrl` and `apiUrl` in [`tests/browser/testApi.ts`](tests/browser/testApi.ts.md)).

## Configuration

- `globalSetup` is [`tests/browser/testApi.ts`](tests/browser/testApi.ts.md), which starts the test API and returns its teardown.
- `webServer` runs `npm run build` with `NEXT_PUBLIC_MEDI_WISH_API_URL=http://127.0.0.1:18115`, then `npm run start -- --hostname 127.0.0.1 --port 3115`, so the frontend listens on the loopback address only. It never reuses a running server, so a stale build or a development server cannot be tested by mistake. The build replaces `.next/`, so build again before serving the development configuration. It serves through the existing `start` script, so Next.js prints that `next start` does not support `output: 'standalone'`; the pages and assets still serve, and serving the standalone `server.js` instead is deployment work (see [`next.config.ts`](next.config.ts.md)).
- `workers: 1` runs the specs one at a time, so their API responses and console lines cannot interleave. `forbidOnly` fails a run that contains `test.only`, and the test timeout is 120 seconds because the journey waits out a 10-second access token.
- Traces, videos and screenshots are off, and the reporter is `list`, so no run writes credentials or tokens to an artifact.

## Use and verification

From `frontend/`, build the backend jar first (`cd ../backend; .\mvnw.cmd -o package -DskipTests`), then run `npm run test:browser`. The [test API page](tests/browser/testApi.ts.md) lists the database settings.

Ticket 17 configures both MEDI_WISH_SERVER_API_URL and MEDI_WISH_SITE_URL from the locked test API/frontend origins alongside the public image API URL. The server-rendered catalog uses these settings for request-time API reads and absolute canonical metadata.
