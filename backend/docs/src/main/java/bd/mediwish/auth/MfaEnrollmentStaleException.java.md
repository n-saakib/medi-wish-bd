# `MfaEnrollmentStaleException.java`

Source: [`src/main/java/bd/mediwish/auth/MfaEnrollmentStaleException.java`](../../../../../../../src/main/java/bd/mediwish/auth/MfaEnrollmentStaleException.java)

Public runtime exception: the named enrollment is not the User's current, unexpired pending authenticator, or an active authenticator already exists. `ApiExceptionHandler` maps it to `409 MFA_ENROLLMENT_STALE`; the client starts enrollment again. Covered by `ApiExceptionHandlerTest`, `StaffMfaServiceTest`, `StaffMfaIT`, `StaffMfaRegressionIT` and `ConcurrentMfaIT`.
