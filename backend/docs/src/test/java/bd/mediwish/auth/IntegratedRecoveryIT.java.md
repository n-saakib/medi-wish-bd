# IntegratedRecoveryIT

Source: [IntegratedRecoveryIT.java](../../../../../../../src/test/java/bd/mediwish/auth/IntegratedRecoveryIT.java)

Real HTTP/PostgreSQL regression coverage for the combined Tickets 05, 09 and 17 contracts. A verified-email password reset revokes both an MFA-verified session and a replacement session, including their bearer and refresh credentials; the new password still requires the existing authenticator. A password-confirmed email change revokes another replacement family while preserving the saving verified session and notifying the old verified address.

Public catalog requests with a live replacement bearer or its revoked bearer match anonymous access: category listing succeeds, while unknown category/product IDs receive the same bounded `NOT_FOUND`. Profile reads, profile writes and address creation remain denied to the replacement session and reject its revoked bearer. Logout provides the revocation boundary without waiting for access-token expiry.

Uses the guarded shared `AuthApi` application/schema, synthetic users and captured mail. Credentials and codes remain tracked and captured logs are checked after each test. Execution results belong to the combined integration evidence; authoring these cases does not establish a passing run.
