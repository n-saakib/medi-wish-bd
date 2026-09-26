# `UserProfile.java`

Source: [`src/main/java/bd/mediwish/user/UserProfile.java`](../../../../../../../src/main/java/bd/mediwish/user/UserProfile.java)

Public record `UserProfile(username, mobile, email, mobileVerified)`: the only User fields returned to that User. `UserProfile.from(user)` builds it from a `User`. It is the `user` object in sign-in and refresh responses (`AuthenticationService`), the Spring Security principal of an authenticated request, and the body of `GET /api/user/me`. Password verifiers, IDs and roles are deliberately excluded. Covered directly by `UserProfileTest` and through `AuthControllerTest`, `BearerAccessTokenFilterTest` and the auth/User integration tests.
