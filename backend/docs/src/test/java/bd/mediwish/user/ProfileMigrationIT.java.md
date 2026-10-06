# ProfileMigrationIT.java

Source: [ProfileMigrationIT.java](../../../../../../../src/test/java/bd/mediwish/user/ProfileMigrationIT.java)

## Purpose

Applies the real Liquibase master changelog to an empty guarded PostgreSQL schema and upgrades a populated schema from immediately before 012-user-profile, finding that changeset by ID rather than hard-coding an execution count.

## Populated upgrade

Seeds an existing customer with a real Argon2 password verifier, legacy mobile, mixed-case email, role, active session and SHA-256 refresh-token digest before applying 012. Existing identity, verifier and complete session/refresh rows must survive unchanged; new profile fields start null, version zero and state ACTIVE.

After migration and Hibernate validation, the pre-existing refresh credential rotates in its original session family and authorizes /api/user/me. Password sign-in must also work. Both paths return exactly the established username/mobile/email/mobileVerified projection, with no new profile fields.

## Constraints and isolation

PostgreSQL enforces the state CHECK, required version, one pending change per user, foreign key, 11-character pending-mobile storage and deletion cascade. Fresh installation exercises the same constraints. All values are synthetic; tests own and remove only guarded, isolated test schemas. Tagged integration and regression.
