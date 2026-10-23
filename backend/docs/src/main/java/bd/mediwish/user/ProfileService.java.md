# ProfileService

`profile(userId)` reads the caller's profile and pending mobile in one projected query. `update(userId, sessionId, edit)` locks the User and checks account state, normalized field validity, identical-save no-op, version and then email-change reauthentication before uniqueness. A missing User requires authentication. Name and DOB saves need no password. No-op, stale and closing requests do not invoke email security.

For an email set/change/clear, `AccountEmailSecurity.confirmCurrentPassword` enforces the shared authenticated failure limit. `noRollbackFor=CurrentPasswordInvalidException` preserves wrong-attempt counting. Current-password Argon2 runs inside this transaction only for this authenticated, limited operation.

The service captures the old address/verification, updates fields and profile version, and flushes before the facade's bulk code deletion can clear the persistence context. SQL state 23505 remains the bounded duplicate result. The facade cancels codes, audits, notifies the old verified address and revokes other sessions while retaining the submitting session. Mutation responses read the saved scalar values after clearing; credentials remain outside the profile response.

User clarification (2026-10-19): a rejected profile save, including duplicate-email rejection after a correct password, leaves earlier wrong-password attempts unchanged. The counter reset commits with a successful email change; wrong-password failures still commit their counter through the explicit no-rollback rule.
