# `StaffMfaMigrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaMigrationIT.java)

## Purpose

Changeset `010-staff-mfa` on a populated database (Ticket 06 T6). It applies the first nine changesets directly through Liquibase, inserts a Customer with a session and refresh generation, then starts the application, which applies 010. The existing refresh cookie still rotates with `mfa: NOT_REQUIRED` and the session keeps `NULL` evidence. Direct SQL then proves the constraints: a second `ACTIVE` or second `PENDING` factor for one User, an unknown status, a `staff_bootstrap` row with `id = 2` and a second row with `id = 1` are all rejected.

## Verification

1 test.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed (1 tests).
