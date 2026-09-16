# `next.config.ts`

Source: [`../next.config.ts`](../next.config.ts)

## Purpose

This file is the typed Next.js build configuration and the integration point for `next-intl`.

## Configuration

- `createNextIntlPlugin()` returns a wrapper that connects Next.js to `src/i18n/request.ts` and the request-scoped message catalog.
- `output: 'standalone'` asks Next.js to produce a self-contained production output containing the runtime files needed by the server. This supports a small deployable artifact when deployment work begins.
- `poweredByHeader: false` removes the default framework-identifying response header and avoids unnecessary technology disclosure.

The default export applies the internationalization wrapper to the typed `nextConfig`. No experimental flags, rewrites, proxy rules, or environment secrets are configured here.

## Verification

`next build` validates the config type, plugin loading, message integration, and standalone output. Runtime deployment checks should verify the generated artifact when hosting is introduced.
