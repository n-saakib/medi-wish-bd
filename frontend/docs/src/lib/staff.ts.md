# `src/lib/staff.ts`

Source: [source](<../../../src/lib/staff.ts>).

## Purpose

Loads `GET /api/staff/me` with the session client and projects bounded `{username, roles, superAdmin}` fields. Exactly one accepted role is permitted; Super Admin requires ADMIN. Usernames are bounded to 50 characters and extra fields are dropped. Failures use shared bounded errors; malformed success bodies produce INVALID_RESPONSE.

The flag is display-only and the backend singleton decides it. Exports are `StaffAccess`, `projectStaffAccess` and `fetchStaffAccess`. `tests/StaffHome.test.ts` covers projection limits and request/session behavior.
