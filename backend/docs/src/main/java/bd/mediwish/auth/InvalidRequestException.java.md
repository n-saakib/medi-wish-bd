# `InvalidRequestException.java`

Source: [`src/main/java/bd/mediwish/auth/InvalidRequestException.java`](../../../../../../../src/main/java/bd/mediwish/auth/InvalidRequestException.java)

## Purpose

Public, message-less exception for a request body with a missing, blank or oversized field. `AuthController.login` throws it before any authentication work when the identifier is blank or longer than 320 characters, or the password is blank or longer than `UserService.MAX_PASSWORD_LENGTH`.

## Boundaries

`ApiExceptionHandler` maps it to `400 INVALID_REQUEST`. It carries no field name or value, so the response and logs reveal nothing about the submitted credentials.

## Verification

`AuthControllerTest` covers blank, missing and oversized login fields; `ApiExceptionHandlerTest` covers the `400` mapping.
