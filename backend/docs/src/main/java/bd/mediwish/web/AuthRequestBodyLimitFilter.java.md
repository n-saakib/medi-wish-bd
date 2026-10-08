# `AuthRequestBodyLimitFilter.java`

Source: [`src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/AuthRequestBodyLimitFilter.java)

Package-private filter bounds JSON bodies of the supplied route matcher at MAX_BODY_BYTES (16 KiB). SecurityConfiguration creates a credential/MFA instance immediately after CORS and a catalog-command/pricing instance after authorization. Denied catalog requests therefore retain authentication/authorization errors regardless of their body size or syntax.

It accepts application/json and application/*+json, including charset parameters. Other content types/methods/routes continue to normal handling. A declared oversized body is rejected before reading; otherwise at most one byte beyond the cap is read, bounding chunked and under-declared bodies too. Rejection writes 400 INVALID_REQUEST without request content. Accepted bytes are replayed intact through a cached input stream/reader with corrected content length; async reads are unsupported. The filter logs no body.

AuthRequestBodyLimitFilterTest proves the exact boundary, dishonest Content-Length and pass-through behavior. CatalogSecurityTest proves 17 KiB rejection on every authorized catalog command and that Moderator pricing stays 403 before buffering.