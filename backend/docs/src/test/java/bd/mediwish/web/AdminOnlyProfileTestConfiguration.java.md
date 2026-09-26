# `AdminOnlyProfileTestConfiguration.java`

Source: [`src/test/java/bd/mediwish/web/AdminOnlyProfileTestConfiguration.java`](../../../../../../../src/test/java/bd/mediwish/web/AdminOnlyProfileTestConfiguration.java)

## Purpose

Test-only `@Order(0)` filter chain for `RoleAuthorizationIT`. It matches `SecurityConfiguration.PROTECTED_ROUTES`, reuses the production `BearerAccessTokenFilter`, writes the bounded `ACCESS_DENIED` error through `ApiErrors`, and requires `ROLE_ADMIN`. Role checks therefore run against persisted roles without a production role route. It has no authentication entry point of its own: it only proves current-role 403/200, and `ProfileIT` covers the 401 challenge on the production chain.

## Verification

Exercised by `RoleAuthorizationIT`.
