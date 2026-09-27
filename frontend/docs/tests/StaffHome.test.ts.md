# `tests/StaffHome.test.ts`

Source: [`tests/StaffHome.test.ts`](../../tests/StaffHome.test.ts)

## Purpose

Mounted jsdom coverage for [`StaffHome`](../src/staff/StaffHome.tsx.md) and [`StaffHeader`](../src/shell/StaffHeader.tsx.md) with a real session client over [`fakeApi`](fakeApi.ts.md) routes and a mocked router, plus unit checks of [`projectStaffAccess`](../src/lib/staff.ts.md).

## Verification

- A checking status until `GET /api/staff/me` answers, then `Staff access verified`, the username, translated roles, the `Super Admin` label and the verified Bearer token.
- No `Super Admin` label when `superAdmin` is false.
- One focused alert for `403 MFA_REQUIRED`, a server failure and a malformed body.
- Enrollment-required, verification-required and Customer sessions are redirected without a staff request.
- The header's `Sign out` button calls logout, returns to `/sign-in` and disappears.
- `projectStaffAccess` drops extra fields and rejects empty or oversized role lists, malformed roles, a non-boolean flag, an oversized username and a missing body.
