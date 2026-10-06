# `User.java`

Source: [`src/main/java/bd/mediwish/user/User.java`](../../../../../../../src/main/java/bd/mediwish/user/User.java)

JPA entity for a registered User in `users`: ID, immutable normalized username, mobile, optional email, Argon2 password verifier, mobile verification state and creation time. Ticket 11 adds optional full name and date of birth, profile version (default 0) and account state (default `ACTIVE`). The `roles` element collection remains eager.

The constructor owns the UUID and creation `Instant` and starts with the `CUSTOMER` role and an unverified mobile. `updateProfile` changes only name, email and DOB; `bumpProfileVersion` marks a real profile save; `activateMobile` applies a verified pending number without changing the profile version. Username remains immutable. Constraints belong to Liquibase. `UserProfile.from` remains the smaller session projection; `ProfileView` is the owner-only editing projection.
