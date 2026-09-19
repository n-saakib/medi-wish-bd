# `UserController.java`

Source: [`src/main/java/bd/mediwish/user/UserController.java`](../../../../../../../src/main/java/bd/mediwish/user/UserController.java)

## Purpose

Exposes only `GET /api/user/me`. Registration and all password-session routes now belong to `AuthController`; this controller does not perform a second repository lookup or reconstruct authentication credentials.

The bearer filter supplies `CurrentUserAuthentication.CurrentUser`, which already represents the verified active session, current User and current persisted roles. The controller returns only username, mobile, email and mobile-verification state.

## Verification

`UserControllerTest` verifies the profile projection comes from the current principal, preserves bounded errors when no principal is present, and excludes password and role fields.
