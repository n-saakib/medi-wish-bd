# `MfaStatus.java`

Source: [`src/main/java/bd/mediwish/auth/MfaStatus.java`](../../../../../../../src/main/java/bd/mediwish/auth/MfaStatus.java)

Public enum of how far a session satisfies staff MFA, decided by `StaffAccessPolicy` and returned as `mfa` on every session response (sign-in, refresh and MFA verification):

| Value | Meaning |
| --- | --- |
| `NOT_REQUIRED` | The User holds no staff role (`ADMIN` or `MODERATOR`); roles apply as before. |
| `ENROLLMENT_REQUIRED` | Staff User with no active authenticator; the session may only enroll. |
| `VERIFICATION_REQUIRED` | Staff User whose session carries no evidence for the active authenticator; the session may only verify. |
| `VERIFIED` | The session was verified by the User's current active authenticator; every role applies. |

It is also on `CurrentUserAuthentication.CurrentUser`. Covered by `StaffAccessPolicyTest`, `AuthControllerTest`, `StaffMfaControllerTest` and the staff MFA integration tests.
