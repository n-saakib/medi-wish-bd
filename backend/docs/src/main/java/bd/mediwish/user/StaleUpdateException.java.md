# `StaleUpdateException.java`

Source: [`StaleUpdateException.java`](../../../../../../../src/main/java/bd/mediwish/user/StaleUpdateException.java)

Raised when a changing profile edit carries a version older than `users.profile_version`. It maps to `409 STALE_UPDATE`. An identical normalized retry is handled as a no-op before this check.
