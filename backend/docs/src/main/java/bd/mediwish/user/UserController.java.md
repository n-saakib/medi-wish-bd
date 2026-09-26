# `UserController.java`

Source: [`src/main/java/bd/mediwish/user/UserController.java`](../../../../../../../src/main/java/bd/mediwish/user/UserController.java)

## Purpose

Package-private controller for `GET /api/user/me`. It returns the authenticated `UserProfile` principal set by `BearerAccessTokenFilter`: username, mobile, optional email and mobile-verification state. Passwords, verifiers and roles are never returned. Registration and session routes belong to `AuthController`.

## Boundaries

The route is in `SecurityConfiguration.PROTECTED_ROUTES`, so only a request whose Bearer token `BearerAccessTokenFilter` resolved reaches the controller; others receive `401 AUTHENTICATION_REQUIRED` from the security chain. The controller does no repository lookup of its own; the profile is the one loaded with the verified session.

## Verification

`BearerAccessTokenFilterTest` covers the principal handoff and profile response. `ProfileIT`, `RoleAuthorizationIT` and `LegacyUserMigrationIT` call the route over real HTTP and PostgreSQL.
