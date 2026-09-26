# `UserService.java`

Source: [`src/main/java/bd/mediwish/user/UserService.java`](../../../../../../../src/main/java/bd/mediwish/user/UserService.java)

## Purpose

Registration service for the shared User. `register(username, mobile, email, password)` normalizes through `UserIdentifierNormalizer`, validates, checks uniqueness, encodes the password and saves a `CUSTOMER` User.

## Rules

- **Username:** 3–50 characters from `a-z`, `0-9`, `.`, `_`, `-`, with at least one letter, so a username can never equal a mobile number (Ticket 03.02 A3).
- **Mobile:** non-blank after trimming, at most 30 characters; no format or country rule until Ticket 61.
- **Email:** optional; blank means absent; otherwise at most 320 characters matching `local@domain` without whitespace.
- **Password:** non-blank, 12 to `MAX_PASSWORD_LENGTH` (128) characters. Password text is never trimmed or transformed. `AuthController` reuses the public constant for its login bound.

Invalid input throws `InvalidRegistrationException` before any lookup or hashing. An existing username or mobile throws `DuplicateUserException` before hashing. The insert is flushed so a PostgreSQL unique violation (SQL state `23505`) from a concurrent registration also becomes `DuplicateUserException`; other integrity failures propagate. `ApiExceptionHandler` maps the two nested exceptions to `400 INVALID_REQUEST` and `409 DUPLICATE_USER`. Only the encoded verifier is stored.

## Verification

`UserServiceTest` covers each boundary, the letter rule, whitespace-preserving passwords, duplicate checks and the uniqueness race. `RegistrationIT` covers duplicate registration and concurrent username/mobile races against PostgreSQL.
