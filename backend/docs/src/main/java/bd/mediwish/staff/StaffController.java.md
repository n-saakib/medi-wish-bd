# `StaffController.java`

Source: [`src/main/java/bd/mediwish/staff/StaffController.java`](../../../../../../../src/main/java/bd/mediwish/staff/StaffController.java)

## Purpose

Package-private controller in `bd.mediwish.staff` for `GET /api/staff/me`, the first staff route (Ticket 06). Only an MFA-verified Admin or Moderator session reaches it.

## Behavior

Returns `StaffAccess{username, roles, superAdmin}` from the `CurrentUserAuthentication.CurrentUser` principal: the username, every current role name sorted (for example `["ADMIN", "CUSTOMER"]`) and whether `StaffAccessPolicy.isSuperAdmin` holds for the User named by `StaffBootstrapRepository.superAdminUserId()`. That lookup is the one extra statement this route prepares beyond the profile route.

## Boundaries

`SecurityConfiguration` requires `ROLE_ADMIN` or `ROLE_MODERATOR`, which `StaffAccessPolicy` grants only to a verified session. A restricted staff session gets `403 MFA_REQUIRED`; a Customer or Delivery Person gets `403 ACCESS_DENIED`; no token gets `401`. The package depends on `bd.mediwish.auth` only for the principal, the policy and the bootstrap repository.

## Verification

`StaffMfaIT` covers the response for Admins and Moderators and the denials; `FirstAdminProvisioningIT` and `StaffMfaRegressionIT` cover `superAdmin` true only for the provisioned Admin; `RoleAuthorizationIT` covers role changes on an issued token; `ConcurrentMfaIT` counts its statements.
