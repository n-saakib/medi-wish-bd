# `BackupCodes.java`

Source: [`src/main/java/bd/mediwish/auth/BackupCodes.java`](../../../../../../../src/main/java/bd/mediwish/auth/BackupCodes.java)

Package-private utility for single-use staff backup codes (Ticket 06 D4).

| Member | Behavior |
| --- | --- |
| `COUNT` | `10` codes per enrollment. |
| `generate(random)` | Returns 10 distinct codes of 8 characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789` (no `I`, `L`, `O`, `U`, `0` or `1`), shown as `XXXX-XXXX`. |
| `normalize(code)` | Removes the dash; this is the value whose Argon2 verifier `StaffMfaService` stores, so recovery compares the code without its separator. |

The codes are returned once, in the enrollment response; only their verifiers are persisted in `staff_mfa_backup_codes`. Recovery consumes them atomically. Covered by `StaffMfaThrottleTest` (shape, distinctness and normalization), `StaffMfaServiceTest` and `StaffMfaIT`.

`parse(raw)` validates the raw input as ASCII before Locale.ROOT uppercasing, trims surrounding ASCII whitespace, removes interior literal spaces and at most one dash, then requires exactly eight characters from the generation alphabet. This prevents non-ASCII case expansions (for example sharp-s) from becoming valid codes. Interior tabs, interior line breaks, look-alikes and extra separators give a bounded `InvalidRequestException` without echoing input. `BackupCodesTest` covers accepted/rejected input and 1,000 generated-code round trips. Only the normalized value is matched against Argon2 verifiers.

2026-10-19 review follow-up: the surrounding-ASCII-whitespace parser regression first failed (2 tests, 1 error); the populated Outcome privacy assertion first failed (1 test, 1 failure). After raw.trim() and result-only Outcome.toString(), `.\mvnw.cmd -o test -Dtest=BackupCodesTest,StaffMfaRecoveryServiceTest` passed all 18 affected tests at 13:47:52 +06:00. The earlier full 1,014-unit result predates these two narrow corrections; final broader verification remains a separate gate.
