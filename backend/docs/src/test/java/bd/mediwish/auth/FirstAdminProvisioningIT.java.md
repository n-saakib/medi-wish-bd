# `FirstAdminProvisioningIT.java`

Source: [`src/test/java/bd/mediwish/auth/FirstAdminProvisioningIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/FirstAdminProvisioningIT.java)

## Purpose

The first-Admin operator command against a real schema; each test owns its schema, because the claimed bootstrap row is permanent. The command runs in a non-web context (`spring.main.web-application-type=none`) as the runbook starts it, with the exit hook captured instead of ending the JVM.

- **Provision once, never reopen:** a fresh schema has no User. After a registered owner is provisioned (exit 0), their earlier access and refresh tokens are `401` with one `staff-provisioned` revocation; they enroll, and `/api/staff/me` returns `roles [ADMIN, CUSTOMER]` and `superAdmin: true`; `staff_bootstrap` names them and one `FIRST_ADMIN_PROVISIONED` event exists. A run for another User exits 1. After the owner loses `ADMIN`, their verified token is `403 ACCESS_DENIED` on the staff route, a further run still exits 1, the Super Admin never transfers and no Admin exists. The log contains `provisioned` and `refused: bootstrap-used` and no tracked secret.
- **Refusals and concurrency:** an unknown username (`user-not-found`) and an existing Admin (`admin-exists`) exit 1 and leave `staff_bootstrap` empty; two parallel `provision` calls give exactly one `PROVISIONED` and one `BOOTSTRAP_USED`, and one `ADMIN` row.
- **Serving application:** launching the web application with the username set fails with `first-Admin provisioning requires spring.main.web-application-type=none`, and nothing is provisioned.

## Verification

3 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed (3 tests).
