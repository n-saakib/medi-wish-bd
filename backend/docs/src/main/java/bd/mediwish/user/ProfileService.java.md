# `ProfileService.java`

Source: [`ProfileService.java`](../../../../../../../src/main/java/bd/mediwish/user/ProfileService.java)

`profile(userId)` reads the caller's profile and pending mobile in one projected query. `update(userId, edit)` takes the User row lock, checks account state, validates values using the current Asia/Dhaka date, treats a normalized identical edit as a no-op even with an old version, then checks version and email uniqueness before writing and bumping `profile_version`. PostgreSQL unique SQL state `23505` becomes the bounded duplicate result. A missing User becomes authentication required. Neither path revokes sessions or changes username/mobile.
