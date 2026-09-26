# `SessionRestartIT.java`

Source: [`src/test/java/bd/mediwish/auth/SessionRestartIT.java`](../../../../../../src/test/java/bd/mediwish/auth/SessionRestartIT.java)

## Purpose

Exercises session durability across a real application restart against an isolated PostgreSQL 18 schema. The test uses one synthetic User with two session families: it revokes one through logout before shutdown, then verifies after restart that the other family remains active while both access and refresh credentials from the revoked family remain rejected. It also verifies that replaying a consumed refresh token after restart revokes the still-active family and invalidates its rotated access token.

## Verification boundary

After restart, the test verifies persisted pre-restart logout, consumes the active family's rotated refresh response, then replays the old consumed refresh value and confirms that replay revokes the family and invalidates the rotated access token. It verifies durable revocation and rotation/replay state across restart; it does not simulate a discarded response, database commit failure, or a network-level response drop.

From `backend/`, run the focused integration-test class with the repository-local Maven cache:

```text
.\\mvnw.cmd -o "-Dmaven.repo.local=D:\\Web Dev\\medi-wish-bd\\backend\\.m2\\repository" "-Dit.test=SessionRestartIT" verify
```
