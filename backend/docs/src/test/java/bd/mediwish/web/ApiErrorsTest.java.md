# `ApiErrorsTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiErrorsTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiErrorsTest.java)

## Purpose and test boundary

This unit test verifies the bounded public error contract without starting Spring. It supplies an in-memory message source, a JSON mapper and a mock servlet request/response so serialization and privacy rules can be checked directly.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `emitsOnlyThePublicErrorContractInEnglish()` | Builds `ApiErrors` with the real `messages` bundle, attaches a request ID plus private exception/query values, writes a 401 response, and requires exact JSON fields/code/message/request ID, status 401 and `Cache-Control: no-store`. It also checks a 599 status maps to `INTERNAL_ERROR` and 403 resolves the expected English message; private values never appear. |

The test asserts the consumer-visible contract rather than the implementation's JSON library details.

## Verification

Run with the Maven unit suite (`test`). `HealthIT` adds the same contract checks over the actual HTTP security/error pipeline.
