# `InvalidProfileException.java`

Source: [`InvalidProfileException.java`](../../../../../../../src/main/java/bd/mediwish/user/InvalidProfileException.java)

Signals a validation failure in a named profile field. It stores only the field name, never the rejected personal value. `ApiExceptionHandler` maps it to bounded `400 INVALID_REQUEST`.
