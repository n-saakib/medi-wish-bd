# `UserProfileTest.java`

Source: [`src/test/java/bd/mediwish/user/UserProfileTest.java`](../../../../../../../src/test/java/bd/mediwish/user/UserProfileTest.java)

## Purpose

Direct unit test of the profile record returned after sign-in, refresh and from `/api/user/me`.

## Verification

`UserProfile.from(user)` maps username, mobile, email and `mobileVerified`, and the record has exactly those four components, so the password verifier and roles cannot leak through it.
