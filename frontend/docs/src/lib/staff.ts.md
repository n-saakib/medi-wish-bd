# `src/lib/staff.ts`

Source: [`src/lib/staff.ts`](../../../src/lib/staff.ts)

## Purpose

The staff API client. It loads what the signed-in staff member may do from `GET /api/staff/me`, which the API answers only for an MFA-verified Admin or Moderator session, and projects the answer to bounded fields.

## Exports

- `StaffAccess` — `{ username, roles, superAdmin }`.
- `fetchStaffAccess(session)` — sends the request through the given `authenticatedFetch` (the [session provider](../auth/SessionProvider.tsx.md)'s, so a `401` after one refresh ends the session). A non-2xx answer rejects with a bounded `ApiError`, such as `403 MFA_REQUIRED` for a restricted session; a malformed body rejects with `INVALID_RESPONSE`.
- `projectStaffAccess(body)` — keeps `username` (1–50 characters), `roles` (1–8 upper-case role names of at most 32 characters) and the boolean `superAdmin`, and drops every other field; anything else returns `undefined`.

## Use cases and boundaries

Used by [`StaffHome`](../staff/StaffHome.tsx.md). The Super Admin flag is display-only: the API decides it (the single provisioned Admin while they hold ADMIN), and no frontend code can change it.

## Verification

[`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts.md) covers the request, the Bearer token, error copy and each projection bound.
