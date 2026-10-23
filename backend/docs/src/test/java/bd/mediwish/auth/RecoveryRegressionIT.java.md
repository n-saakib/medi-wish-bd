# RecoveryRegressionIT

Source: [RecoveryRegressionIT.java](../../../../../../../src/test/java/bd/mediwish/auth/RecoveryRegressionIT.java)

## Purpose

Ticket 5 T6 exercises account-recovery regressions, privacy boundaries and mail failure behavior through the real HTTP API, the guarded PostgreSQL integration schema, and the in-memory mail transport.

## Coverage

- Email remains optional at registration; a new account without an email can sign in and its profile reports `email: null` and `emailVerified: false`.
- A user in `CLOSURE_REQUESTED` can reset the password without leaving that state or regaining permission to edit the profile.
- Email verification, password reset and a password-confirmed email change preserve fingerprints for every unrelated base table. The reset also preserves role, role version, profile version, mobile, mobile-verification and email-verification state.
- A verified Admin and the provisioned Super Admin retain the complete MFA-factor and backup-code row digests across reset. New password sign-in still requires TOTP; the Super Admin identity and the regular Admin distinction remain intact. An Admin with a pending enrollment remains restricted to enrollment after reset.
- Unknown, wrong and expired reset codes share the same bounded `CODE_INVALID` code and message. Audit and session rows are checked for recovery credentials, code hashes and the HMAC key.
- A failed code delivery still returns the uniform empty `202`, keeps its code row, records `EMAIL_DELIVERY_FAILED`, and does not retry. A later request after the issuance gap sends a replacement code. A failed password-changed notice leaves the committed reset usable.
- A test-only transactional probe registers mail and then rolls back; the after-commit adapter must send nothing. A discarded successful confirm response followed by an identical retry returns `CODE_INVALID`, while the new password works.

The table fingerprint helper discovers tables in the run-owned schema and hashes all sorted row text together with each count; diagnostics do not print row values. MFA checks digest complete rows rather than selecting only status fields. Captured output is checked after each test against the tracked account values and recovery codes.

Tagged `integration`, `regression` and `security`. Tests were not run during this bounded implementation task; verification is recorded by the parent Ticket 5 integration run.
