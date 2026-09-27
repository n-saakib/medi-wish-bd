# `src/app/(staff)/staff/page.tsx`

Source: [`src/app/(staff)/staff/page.tsx`](../../../../../src/app/(staff)/staff/page.tsx)

## Purpose

The `/staff` route: the placeholder staff landing page that only an MFA-verified Admin or Moderator session reaches.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `staffHome.pageTitle` (`Staff`), rendered as `Staff · Medi Wish`.

### `StaffPage()`

Renders a `<main>` with the `auth-card` width and [`StaffHome`](../../../staff/StaffHome.tsx.md), which owns the guard, the `GET /api/staff/me` request and its states.

## Use cases and boundaries

Statically generated; the server output holds no staff data. The response carries `Cache-Control: no-store` from [`next.config.ts`](../../../../next.config.ts.md). The real dashboard is Ticket 48.

## Verification

On 2026-09-27 `npm run build` produced `/staff` as a static route, and a local `next start` answered `/staff`, `/staff/mfa` and `/staff/mfa/enroll` with `Cache-Control: no-store`. Behavior is covered by [`tests/StaffHome.test.ts`](../../../../tests/StaffHome.test.ts.md).
