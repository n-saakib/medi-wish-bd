# `next.config.ts`

Source: [source](<../next.config.ts>).

## Purpose

Wraps the next-intl plugin, emits standalone output and disables powered-by. `headers()` serves `/staff/:path*` and `/admin/:path*` documents with Cache-Control: no-store because they can show staff credentials or private user data. API calls independently use the uncached session client. Browser suites check document headers.
