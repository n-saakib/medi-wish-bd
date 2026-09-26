# `AuthenticationFailedException.java`

Source: [`src/main/java/bd/mediwish/auth/AuthenticationFailedException.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthenticationFailedException.java)

Public, message-less exception for every password sign-in failure: unknown or ambiguous identifier, unusable stored verifier or wrong password. It carries no identifier, candidate count, password or account-state detail. `ApiExceptionHandler` maps it to `401 AUTHENTICATION_FAILED`. Covered by `AuthenticationServiceTest` and `ApiExceptionHandlerTest`.
