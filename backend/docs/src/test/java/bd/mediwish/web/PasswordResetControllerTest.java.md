# PasswordResetControllerTest.java

Source: [PasswordResetControllerTest.java](../../../../../../../src/test/java/bd/mediwish/web/PasswordResetControllerTest.java)

Standalone MVC tests exercise the real reset adapter, JSON conversion, error advice and correlation filter with a mocked service. They protect exact keys/types, normalization, ASCII code shape, A5 password bounds and whitespace, generic empty 202 answers, empty 204 confirmation, bounded CODE_INVALID/non-JSON errors, no-store and absence of session cookies. Rejected shapes never invoke the service.
