# ProfileMigrationIT.java

Source: [ProfileMigrationIT.java](../../../../../../../src/test/java/bd/mediwish/user/ProfileMigrationIT.java)

## Purpose

Applies the real Liquibase master changelog to an empty guarded PostgreSQL schema and upgrades a populated schema from immediately before 012-user-profile, finding that changeset by ID rather than hard-coding an execution count.

## Populated upgrade

Seeds an existing customer with a real Argon2 password verifier, legacy mobile, mixed-case email, role, active session and SHA-256 refresh-token digest before applying 012. Existing identity, verifier and complete session/refresh rows must survive unchanged; new profile fields start null, version zero and state ACTIVE.

After migration and Hibernate validation, the pre-existing refresh credential rotates in its original session family and authorizes /api/user/me. Password sign-in must also work. Both paths return exactly the established username/mobile/email/mobileVerified projection, with no new profile fields.

## Constraints and isolation

PostgreSQL enforces the state CHECK, required version, one pending change per user, foreign key, 11-character pending-mobile storage and deletion cascade. Fresh installation exercises the same constraints. Because Ticket 08's changeset 011 runs before 012 and its deferred trigger requires every committed User to hold a role, each raw User insert adds its `CUSTOMER` role in the same statement. All values are synthetic; tests own and remove only guarded, isolated test schemas. Tagged integration and regression.

## Ticket09 additive-migration compatibility

The 2026-10-20 cumulative run at13968d1 plus Ticket09 working changes reproduced an upgrade snapshot failure: changeset018 adds the nullable `mfa_replacing_factor_id` field, changing composite-row text without changing a legacy value. Both session snapshots now compare every pre-existing field through JSONB with only that key excluded, then separately assert that its post-upgrade value is null. Password/identity/profile defaults, complete refresh-row preservation, real refresh rotation, password sign-in and all profile constraints remain checked. Corrected focused and full reruns are pending; historical profile verification does not prove this correction.
