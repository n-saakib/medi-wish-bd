# `TooManyAttemptsException.java`

Source: [`src/main/java/bd/mediwish/auth/TooManyAttemptsException.java`](../../../../../../../src/main/java/bd/mediwish/auth/TooManyAttemptsException.java)

Public runtime exception: MFA verification is locked after too many wrong codes (Ticket 06 D3). `StaffMfaService` throws it for the failure that reaches the limit and for every attempt while locked; `ApiExceptionHandler` maps it to `429 TOO_MANY_ATTEMPTS`. Covered by `ApiExceptionHandlerTest`, `StaffMfaServiceTest`, `StaffMfaIT` and `StaffMfaRegressionIT`.
