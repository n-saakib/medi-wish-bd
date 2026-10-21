# StaffMfaRecoveryRegressionIT.java

Ticket 09 T6 regression, security and recovery coverage for backup-code recovery, through real HTTP routes and the guarded PostgreSQL schema. Tagged `integration`, `regression`, `security` and `recovery`; uses AuthApi.Shared, plus one isolated application with a one-second notice timeout.

- **R1, password half:** after a replacement, a password-only sign-in and its refresh stay `VERIFICATION_REQUIRED` and get 403 on `/api/staff/me` until the new authenticator verifies. The bytecode check that only the replacement may revoke or bulk-write factors lives in `StaffMfaFactorWriteScanTest`.
- **R1, notice half:** a throwing notifier and a hung notifier (bounded by `app.notification.security.timeout=PT1S`; the verify call returns in under 3 s) both return `contactNotice` `FAILED` with ten new codes, a usable verified session, the new factor active, the old one revoked and the failure audited. No verified mobile completes with `NO_VERIFIED_CONTACT` and sends nothing.
- **Role changes (P10, AC4):** a Ticket 08 demotion after the code is used, or between enrollment start and verify, ends the replacement session (401), keeps the old factor active and never activates the pending one; the role is not restored, and re-promotion signs in with the old authenticator. A race of recovery against demotion always ends as a Customer with the old factor and no live replacement session; a recovery that won is revoked.
- **Ticket 10 contract:** an SQL factor revoke downgrades the replacement refresh to `ENROLLMENT_REQUIRED`, and its pending verify is refused (403/409), never `VERIFIED`.
- **Abuse:** three wrong TOTP and two wrong backup codes share the 429 lock and the correct code stays unconsumed; twenty malformed bodies and a 17 KiB body give 400 without counting; audit rows (timestamp excluded) and error bodies hold no code, seed, token, password, username or mobile, and logs are checked after each test.

The ten-minute expiry case is covered by `StaffMfaRecoveryIT.replacementRefreshNeverExtendsItsTenMinuteDeadline` with a controlled clock, so it is not repeated here. All data is synthetic.
