# `StaffAccessPolicyTest.java`

Source: [StaffAccessPolicyTest.java](../../../../../../../src/test/java/bd/mediwish/auth/StaffAccessPolicyTest.java)

Five tests of the single-role decision: Customer/DeliveryPerson authorities without MFA, enrollment-only staff, challenge-only staff with missing/replaced evidence, one verified staff authority, and bootstrap identity plus ADMIN for the Super Admin. SecurityConfigurationTest covers lower-role hierarchy expansion separately.
