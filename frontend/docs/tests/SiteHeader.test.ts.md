# `tests/SiteHeader.test.ts`

Source: [`tests/SiteHeader.test.ts`](../../tests/SiteHeader.test.ts)

## Purpose

Mounted jsdom coverage for [`SiteHeader`](../src/shell/SiteHeader.tsx.md) using [`renderWithSession`](renderWithSession.ts.md) and the shared [`fakeApi`](fakeApi.ts.md) fixtures.

## Verification

- A signed-out visitor sees a `Sign in` link to `/sign-in`, and the logo links to `/`.
- A restored user sees a link to `/account` labelled with the username.
- While the restore is held open, the navigation contains no link, so the header never shows the wrong state.

Responsive label hiding is CSS behavior and is not asserted here. On 2026-09-26 this suite passed as part of `npm run test:unit`.
