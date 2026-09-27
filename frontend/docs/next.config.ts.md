# `next.config.ts`

Source: [`../next.config.ts`](../next.config.ts)

## Purpose

This file is the typed Next.js build configuration and the integration point for `next-intl`.

## Configuration

- `createNextIntlPlugin()` returns a wrapper that connects Next.js to `src/i18n/request.ts` and the request-scoped message catalog.
- `output: 'standalone'` asks Next.js to produce a self-contained production output containing the runtime files needed by the server. This supports a small deployable artifact when deployment work begins.
- `poweredByHeader: false` removes the default framework-identifying response header and avoids unnecessary technology disclosure.
- `headers()` adds `Cache-Control: no-store` to every `/staff/:path*` response (`/staff`, `/staff/mfa`, `/staff/mfa/enroll`), so browsers and shared caches keep no copy of staff pages. The rule replaces the default static-page cache header on those routes only; other pages keep it. The setup secret is never in the server HTML, but the header also stops the back/forward and HTTP caches from holding staff pages at all.

The default export applies the internationalization wrapper to the typed `nextConfig`. No experimental flags, rewrites, proxy rules, or environment secrets are configured here.

## Verification

`next build` validates the config type, plugin loading, message integration, and standalone output. On 2026-09-27 a local `next start` of the production build answered `/staff`, `/staff/mfa` and `/staff/mfa/enroll` with `Cache-Control: no-store` and `/sign-in` with the default `s-maxage=31536000`; the server was stopped afterwards. Runtime deployment checks should verify the generated artifact when hosting is introduced.
