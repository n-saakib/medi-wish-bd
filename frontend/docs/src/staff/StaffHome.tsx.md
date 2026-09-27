# `src/staff/StaffHome.tsx`

Source: [`src/staff/StaffHome.tsx`](../../../src/staff/StaffHome.tsx)

## Purpose

Client component for `/staff`, the placeholder staff landing page. It proves that only an MFA-verified staff session reaches staff routes by loading [`fetchStaffAccess`](../lib/staff.ts.md) from `GET /api/staff/me`.

## Export

### `StaffHome()`

Uses `useSessionRedirect('staff')`. For a `VERIFIED` session it shows `Checking your staff access…` until the API answers, then a card with `Staff access verified`, the username, the roles (translated names such as `Admin, Moderator`) and, when `superAdmin` is true, a `Super Admin` text label. A failure shows one focused danger alert with the mapped `errors` copy, for example `Authenticator verification is required.` for `403 MFA_REQUIRED`. No request is sent for a session that is not verified; the guard redirects it instead.

## Design deviation

The staff dashboard (`staff-dashboard.html`) belongs to Ticket 48. This page is a deliberate placeholder with only the verified-access summary. The Super Admin label is text, not colour alone.

## Verification

[`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts.md).
