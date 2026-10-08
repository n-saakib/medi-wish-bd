# `src/staff/StaffHome.tsx`

Source: [`src/staff/StaffHome.tsx`](../../../src/staff/StaffHome.tsx)

## Purpose

Client component for `/staff`, the verified staff landing page. It loads [`fetchStaffAccess`](../lib/staff.ts.md) from `GET /api/staff/me` before showing role-appropriate catalog links.

## Export

### `StaffHome()`

Uses `useSessionRedirect('staff')`. For a `VERIFIED` session it shows `Checking your staff access…` until the API answers, then a card with `Staff access verified`, the username, translated roles and, when applicable, a `Super Admin` text label. Admin and Moderator see Products then Categories links. A failure shows one focused danger alert with mapped `errors` copy. No staff request is sent for a session that is not verified.

## Design deviation

The staff dashboard (`staff-dashboard.html`) belongs to Ticket 48. This page keeps the verified-access summary and adds the two Ticket 14 destinations. The Super Admin label is text, not colour alone.

## Verification

[`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts.md).
