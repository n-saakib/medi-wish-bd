# `StaffAccessPolicyTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffAccessPolicyTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffAccessPolicyTest.java)

## Purpose

Unit test of `StaffAccessPolicy.evaluate` and `isSuperAdmin`: non-staff Users (Customer, Delivery Person) keep their role authorities with `NOT_REQUIRED`; staff without an active factor get only `MFA_ENROLLMENT`; staff whose session has no evidence, evidence for another factor, or no verification time get only `MFA_CHALLENGE`; a verified staff session gets every role; the Super Admin is the bootstrap User only while they hold `ADMIN`.

## Verification

5 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
