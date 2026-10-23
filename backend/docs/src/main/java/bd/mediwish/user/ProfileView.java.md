# `ProfileView.java`

Source: [`ProfileView.java`](../../../../../../../src/main/java/bd/mediwish/user/ProfileView.java)

Owner-only response projection with exactly username, full name, current mobile and verification flag, pending mobile, email and its separate boolean verification flag, DOB, account state and profile version. `from(User, MobileChange)` builds mutation responses. A repository constructor projection builds the read response in one query without loading the eager role collection. No password, role, session or pending change ID reaches the client.

Email verification is exposed as `emailVerified`, immediately after `email`; its timestamp stays internal and verification alone never changes the profile version.
