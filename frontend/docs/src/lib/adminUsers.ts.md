# `src/lib/adminUsers.ts`

Source: [source](<../../../src/lib/adminUsers.ts>).

## Purpose and contract

The Admin API client for the Users and roles pages. `listUsers` sends `POST /api/admin/users/search` with filters in its JSON body; usernames never enter URLs. `loadUserRoles` and `saveRole` identify Users by UUID, and saving sends exactly the desired role and loaded version. The session provider handles Bearer authentication, refresh and expiry.

`UserSummary`, `UserRoles`, `RoleChange`, `UserPage`, `UserFilter`, `UserRole`, `StaffMfaState` and `userRoles` describe the contract. `projectUserSummary` and `projectUserRoles` discard unrelated fields and reject malformed IDs, role/MFA names, timestamps, versions, impossible Super Admin flags, duplicate choices and unbounded arrays (50 Users, 4 choices, 20 changes). Deleted history actors remain null. `isUserId` and `isUserRole` support runtime validation. Responses use the shared 16 KiB JSON reader and bounded errors. `tests/adminUsers.test.ts` covers requests, projections and failures.
