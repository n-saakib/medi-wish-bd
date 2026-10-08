# `src/staff/StaffHome.tsx`

Source: [source](<../../../src/staff/StaffHome.tsx>).

## Purpose

Client component for `/staff`, the verified staff landing page. It loads [`fetchStaffAccess`](../lib/staff.ts.md) from `GET /api/staff/me` only in `VERIFIED` sessions before showing role-appropriate links.

## Export

### `StaffHome()`

Uses `useSessionRedirect('staff')`. It shows `Checking your staff access…` until the API answers, then a card with `Staff access verified`, the username, the translated one-role summary and, when applicable, a `Super Admin` text label. One navigation landmark named `Staff pages` follows in the plan §8.2 order: Users and roles (Admin only), then Products and Categories (Admin and Moderator). API authorization remains authoritative. A failure shows one focused danger alert with mapped `errors` copy.

## Design deviation

The staff dashboard (`staff-dashboard.html`) and full staff navigation belong to Ticket 48. This page keeps the verified-access summary and adds the Ticket 08 and Ticket 14 destinations. The Super Admin label is text, not colour alone.

## Verification

[`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts.md); browser checks E2E-08-29 (Admin-only Users and roles) and E2E-14-04 (the full link order for Admin and Moderator).
