# `src/app/(staff)/admin/users/[userId]/page.tsx`

Source: [source](<../../../../../../../src/app/(staff)/admin/users/[userId]/page.tsx>).

## Purpose

The `/admin/users/<UUID>` route uses the staff layout/header and client `UserRolePage`. Metadata is a translated static title. Private data loads through the browser's authenticated API after the session guard; invalid UUIDs show not-found without an Admin API call. The Admin document privacy header disables caching.
