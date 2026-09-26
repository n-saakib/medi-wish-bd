# `AuthRequestBodyLimitFilter.java`

Source: [`src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java)

## Purpose

Package-private filter that bounds the JSON bodies of the routes it is given, which `SecurityConfiguration` sets to `CREDENTIAL_ROUTES` (`POST /api/auth/login` and `POST /api/auth/register`), at `MAX_BODY_BYTES` (16 KiB) before MVC and Jackson read them. `SecurityConfiguration` constructs it and places it right after `BoundedCorsFilter`; it is not a Spring bean.

## Behavior

- It runs only for requests the matcher accepts, which matches paths as Spring MVC routes them (so `/api/auth/%6Cogin` is bounded like `/api/auth/login`), with an `application/json` or `application/*+json` content type. Other methods, paths, missing, malformed or non-JSON content types continue to normal MVC handling (for example `415`).
- A declared `Content-Length` over the limit is rejected before reading. Otherwise it reads at most one byte beyond the limit, so chunked or under-declared bodies are also bounded.
- A rejected body returns `400 INVALID_REQUEST` through `ApiErrors.write`. An accepted body is replayed through a request wrapper (`getInputStream`, `getReader` using the request charset or UTF-8, and corrected content length); asynchronous reads are unsupported.

The filter never logs request bodies and does not buffer any other request.

## Verification

`AuthRequestBodyLimitFilterTest` covers a body exactly at the limit reaching the controller intact, oversized JSON rejection whatever `Content-Length` declares, and pass-through of other methods, paths and content types.
