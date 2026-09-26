# `ApiAssertions.java`

Source: [`src/test/java/bd/mediwish/testsupport/ApiAssertions.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/ApiAssertions.java)

## Purpose

Shared assertions. `assertError(response, status, code)` requires exactly `code`, `message` and `requestId`, the message from `messages.properties` `error.CODE`, and the response's own request ID. `assertOmits` fails when a secret appears in a response body or header, or in given text, naming only where it appeared and never the value. `json(response)` reads a body as a map.

## Verification

Used by the auth, health and compatibility integration tests.
