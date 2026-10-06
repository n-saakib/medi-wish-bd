# `UserService.java`

Source: [`src/main/java/bd/mediwish/user/UserService.java`](../../../../../../../src/main/java/bd/mediwish/user/UserService.java)

## Purpose

Registration service for the shared User. `register(username, mobile, email, password)` normalizes through `UserIdentifierNormalizer`, validates, checks uniqueness, encodes the password and saves a `CUSTOMER` User.

## Rules

- **Username:** accepted P12 format: 3–20 ASCII characters from `a-z`, `0-9`, `.`, `_`, `-`, with at least one letter.
- **Mobile:** exactly 11 ASCII digits after trimming. Country/E.164 conversion remains Ticket 61 work.
- **Email:** optional; blank means absent; otherwise the P12 dot-atom address subset, at most 254 total characters, local part at most 64, and domain labels at most 63 each. `IdentifierFormats` owns these rules for both registration and profile edits.
- **Password:** non-blank, 6 to 30 characters (the user's rule, 2026-09-26). Password text is never trimmed or transformed. Sign-in keeps its own wider bound in `AuthController`.

Invalid input throws `InvalidRegistrationException` before any lookup or hashing. An existing username or mobile throws `DuplicateUserException` before hashing. The insert is flushed so a PostgreSQL unique violation (SQL state `23505`) also becomes `DuplicateUserException`: from a concurrent registration, or from a taken email, which only the unique `upper(email)` index checks; other integrity failures propagate. `ApiExceptionHandler` maps the two nested exceptions to `400 INVALID_REQUEST` and `409 DUPLICATE_USER`. Only the encoded verifier is stored.

## Verification

`UserServiceTest` covers the current identifier boundaries, whitespace-preserving passwords, duplicate checks and the uniqueness race. `RegistrationIT` covers rejected P12 inputs, duplicate registration and concurrent username/mobile races against PostgreSQL.
