# `UserController.java`

Source: [`src/main/java/bd/mediwish/user/UserController.java`](../../../../../../../src/main/java/bd/mediwish/user/UserController.java)

## Purpose

Package-private controller for `GET /api/user/me`. It returns the `profile` of the `CurrentUserAuthentication.CurrentUser` principal set by `BearerAccessTokenFilter` (`@AuthenticationPrincipal(expression = "profile")`): username, mobile, optional email and mobile-verification state. Passwords, verifiers, roles and MFA state are never returned. Registration and session routes belong to `AuthController`.

## Boundaries

The route is in `SecurityConfiguration.PROTECTED_ROUTES` and requires any of `ROLE_CUSTOMER`, `ROLE_ADMIN`, `ROLE_MODERATOR` or `ROLE_DELIVERY_PERSON`. A request without a resolved Bearer token receives `401 AUTHENTICATION_REQUIRED`; a restricted staff session, which holds only an MFA authority, receives `403 MFA_REQUIRED`. The controller does no repository lookup of its own; the profile is the one loaded with the verified session.

## Verification

`BearerAccessTokenFilterTest` covers the principal handoff. `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT` and `LegacyUserMigrationIT` call the route over real HTTP and PostgreSQL.
