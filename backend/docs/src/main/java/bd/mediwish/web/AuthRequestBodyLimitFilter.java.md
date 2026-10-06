# `AuthRequestBodyLimitFilter.java`

Source: [AuthRequestBodyLimitFilter.java](../../../../../../../src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java)

Package-private filter bounds JSON command bodies to MAX_BODY_BYTES (16 KiB) before MVC/Jackson. SecurityConfiguration supplies credential, MFA and administrative Bearer-command matchers, including the User search POST and role PUT.

A declared oversize is refused before reading; otherwise the filter reads at most one byte beyond the limit, covering chunked/under-declared bodies. Valid JSON content types include application/*+json. Accepted bytes are replayed through a request wrapper; nonmatching/non-JSON requests continue to MVC. Rejections use the bounded INVALID_REQUEST envelope and log no body.

AuthRequestBodyLimitFilterTest verifies exact limits, declared-size variants, pass-through and both administrative command routes.
