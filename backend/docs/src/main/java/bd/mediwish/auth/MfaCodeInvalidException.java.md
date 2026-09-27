# `MfaCodeInvalidException.java`

Source: [`src/main/java/bd/mediwish/auth/MfaCodeInvalidException.java`](../../../../../../../src/main/java/bd/mediwish/auth/MfaCodeInvalidException.java)

Public runtime exception for a well-formed authenticator code that is wrong or already used. `StaffMfaService` throws it after the failure has been committed; `ApiExceptionHandler` maps it to `400 MFA_CODE_INVALID`. A malformed code is `InvalidRequestException` instead. Covered by `ApiExceptionHandlerTest`, `StaffMfaServiceTest` and `StaffMfaIT`.
