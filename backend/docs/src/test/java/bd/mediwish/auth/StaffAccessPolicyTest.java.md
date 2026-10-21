# `StaffAccessPolicyTest.java`

Source: [StaffAccessPolicyTest.java](../../../../../../../src/test/java/bd/mediwish/auth/StaffAccessPolicyTest.java)

Tests of the single-role decision: Customer/DeliveryPerson authorities without MFA, enrollment-only staff, challenge-only staff with missing/replaced evidence, one verified staff authority, and bootstrap identity plus ADMIN for the Super Admin. SecurityConfigurationTest covers lower-role hierarchy expansion separately.

Ticket 09 adds both staff roles with valid replacement evidence, wrong/no active-factor downgrade, verified-precedence and non-staff evidence ignoring; the restricted-authority set must include MFA_REPLACEMENT.
