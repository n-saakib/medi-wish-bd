# `AuthRequestBodyLimitFilter.java`

Source: [AuthRequestBodyLimitFilter.java](../../../../../../../src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java)

Package-private filter bounds JSON command bodies to MAX_BODY_BYTES (16 KiB) before MVC/Jackson. SecurityConfiguration supplies credential, MFA and administrative Bearer-command matchers, including the User search POST and role PUT.

A declared oversize is refused before reading; otherwise the filter reads at most one byte beyond the limit, covering chunked/under-declared bodies. Valid JSON content types include application/*+json. Accepted bytes are replayed through a request wrapper; nonmatching/non-JSON requests continue to MVC. Rejections use the bounded INVALID_REQUEST envelope and log no body.

## Behavior

- It runs only for requests the matcher accepts, which matches paths as Spring MVC routes them (so `/api/auth/%6Cogin` is bounded like `/api/auth/login`), with an `application/json` or `application/*+json` content type. Other methods, paths, missing, malformed or non-JSON content types continue to normal MVC handling (for example `415`).
- A declared `Content-Length` over the limit is rejected before reading. Otherwise it reads at most one byte beyond the limit, so chunked or under-declared bodies are also bounded.
- A rejected body returns `400 INVALID_REQUEST` through `ApiErrors.write`. An accepted body is replayed through a request wrapper (`getInputStream`, `getReader` using the request charset or UTF-8, and corrected content length); asynchronous reads are unsupported.

The filter never logs request bodies and does not buffer any other request.

## Verification

`AuthRequestBodyLimitFilterTest` covers a body exactly at the limit reaching the controller intact, oversized JSON rejection whatever `Content-Length` declares, and pass-through of other methods, paths and content types.

Profile PUT and mobile POST/DELETE are included through BEARER_COMMAND_ROUTES. JSON commands are capped at 16 KiB; a bodyless DELETE without Content-Type passes unchanged. ProfileBodyLimitTest checks the exact byte boundary for both JSON commands and bodyless cancellation.
AuthRequestBodyLimitFilterTest verifies exact limits, declared-size variants, pass-through and both administrative command routes.
