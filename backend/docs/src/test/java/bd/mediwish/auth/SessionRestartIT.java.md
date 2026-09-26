# `SessionRestartIT.java`

Source: [`src/test/java/bd/mediwish/auth/SessionRestartIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/SessionRestartIT.java)

## Purpose

Own context, restarted mid-test. Before the restart one session is rotated and another is logged out. After it, the rotated access token still works; the logged-out session's access and refresh tokens are rejected; and replaying the initial, consumed refresh token is a replay that revokes its family (`REFRESH_REPLAY`) together with the rotated access token.

## Verification

1 test.

Verified 2026-09-26 on `72634a6`: `./mvnw.cmd -o verify` passed 171 unit and 106 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 106 with no skip.
