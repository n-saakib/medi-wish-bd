# `FirstAdminProvisioningTest.java`

Source: [`src/test/java/bd/mediwish/auth/FirstAdminProvisioningTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/FirstAdminProvisioningTest.java)

## Purpose

Unit test of `FirstAdminProvisioningService` and `FirstAdminProvisioning` with mocked repositories, session service and audit log: the fixed refusal order of `decide`; provisioning a normalized username grants `ADMIN`, saves, revokes all sessions with `STAFF_PROVISIONED` and audits with no session; an unknown User and a used bootstrap change nothing (the latter without checking for Admins); a blank username makes the runner do nothing; the runner exits 0 only for `PROVISIONED` and 1 for each refusal; and inside a `WebApplicationContext` it throws without calling the service and without the username in the message.

## Verification

15 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
