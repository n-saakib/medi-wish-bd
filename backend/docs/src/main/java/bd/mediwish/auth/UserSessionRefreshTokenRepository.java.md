# UserSessionRefreshTokenRepository

Spring Data boundary for refresh generations. Its hash lookup explicitly uses `PESSIMISTIC_WRITE`, giving PostgreSQL the row lock required for first-writer-wins rotation and replay detection.
