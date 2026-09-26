# `ApiErrorsTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiErrorsTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiErrorsTest.java)

## Purpose and test boundary

This unit test verifies the bounded public error contract through standalone MockMvc; it does not start the Spring application context or an embedded servlet server. It supplies an in-memory message source, a JSON mapper and a mock servlet request/response so serialization and privacy rules can be checked directly.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `emitsOnlyThePublicErrorContractInEnglish()` | Builds `ApiErrors` with the real `messages` bundle, attaches a request ID plus private exception/query values, writes a 401 response, and requires exact JSON fields/code/message/request ID, status 401 and `Cache-Control: no-store`. It also checks a 599 status maps to `INTERNAL_ERROR` and 403 resolves the expected English message; private values never appear. |
| `errorDispatchMapsNotFoundAndServerFailuresToCorrelatedPublicErrors()` | Sends mock requests marked `DispatcherType.ERROR` for 404 and 500 through standalone MockMvc, `ApiErrorController`, and `RequestCorrelationFilter`; verifies the bounded public code/message, matching server request ID, `no-store`, and absence of the synthetic exception detail. This simulates controller dispatch and does not verify an embedded server's `/error` routing or the full production filter chain. |

The test asserts the consumer-visible contract rather than the implementation's JSON library details.

## Verification

Run with the Maven unit suite (`test`). This test exercises a simulated servlet `ERROR` dispatch at the standalone MockMvc/controller boundary. `HealthIT` covers actual HTTP security-denial behavior, not embedded-server 404/500 error routing; that runtime path remains unverified.
