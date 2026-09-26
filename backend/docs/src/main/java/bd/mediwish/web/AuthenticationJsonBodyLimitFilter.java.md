# `AuthenticationJsonBodyLimitFilter.java`

Source: [`src/main/java/bd/mediwish/web/AuthenticationJsonBodyLimitFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/AuthenticationJsonBodyLimitFilter.java)

## Purpose

Endpoint-scoped pre-deserialization guard for unauthenticated JSON `POST /api/auth/login` and `POST /api/auth/register` requests. It caps `application/json` and `application/*+json` bodies at 16 KiB before MVC/Jackson can allocate a larger object and returns the accepted bounded `400 INVALID_REQUEST` contract when the limit is exceeded. Missing, malformed, and non-JSON content types continue through normal MVC media-type handling.

## Boundaries

The filter does not buffer all application requests, alter authentication policy or log request bodies. It replays an accepted bounded body through a small servlet request wrapper so downstream JSON deserialization sees the original content. Chunked requests are bounded by reading at most one byte beyond the limit; declared oversized bodies are rejected before reading.

## Verification

`Ticket03SecurityBoundaryTest` proves oversized JSON login and registration bodies are rejected before controller deserialization with `400 INVALID_REQUEST`, correlation and no-store headers, including a JSON structured-suffix media type. Oversized non-JSON requests bypass this filter and retain MVC's `415` unsupported-media-type response. The filter is installed only in the Ticket 03 security chain for the two exact authentication paths.
