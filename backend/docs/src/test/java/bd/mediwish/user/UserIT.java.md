# `UserIT.java`

Source: [`src/test/java/bd/mediwish/user/UserIT.java`](../../../../../../src/test/java/bd/mediwish/user/UserIT.java)

## Purpose

Exercises the reduced shared-User flow over real HTTP against PostgreSQL 18 and an isolated run-owned schema. It verifies public registration, authenticated common-profile access with normalized credentials, the HTTP Basic challenge value, Argon2-backed authentication, caller-supplied role isolation, concurrent uniqueness handling, bounded unauthorized/duplicate outcomes and the configured local browser preflight. Each scenario uses a generated username so adding or reordering integration cases cannot silently collide with existing data.

## Safety and verification

The test uses synthetic identities and the guarded `TestDatabase` helper; it never targets the development database. Run it through Maven Failsafe with the explicit `TEST_DB_*` settings and record the result with the Ticket 02 resolution.
