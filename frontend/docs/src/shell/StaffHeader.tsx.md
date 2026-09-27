# `src/shell/StaffHeader.tsx`

Source: [`src/shell/StaffHeader.tsx`](../../../src/shell/StaffHeader.tsx)

## Purpose

The header of the `(staff)` route group, ported from the staff top bar in `agent-docs/ui-design/staff-dashboard.html` (drawn by `assets/layout.js`) and reduced to the logo and sign-out.

## Export

### `StaffHeader()`

Renders `.staff-top` with the [`Logo`](Logo.tsx.md) and, once a session is known, a 44 px icon button with the `logout` icon and the accessible name and tooltip `Sign out`. It calls the provider's `signOut` and is disabled while sign-out runs; the staff guard then opens `/sign-in`.

## Design deviation

The design's side navigation, order search, `MFA verified` chip, avatar and name are omitted until the staff console exists (Ticket 48).

## Verification

[`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts.md) signs out through this header.
