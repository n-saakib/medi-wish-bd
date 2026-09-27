# `BackupCodes.java`

Source: [`src/main/java/bd/mediwish/auth/BackupCodes.java`](../../../../../../../src/main/java/bd/mediwish/auth/BackupCodes.java)

Package-private utility for single-use staff backup codes (Ticket 06 D4).

| Member | Behavior |
| --- | --- |
| `COUNT` | `10` codes per enrollment. |
| `generate(random)` | Returns 10 distinct codes of 8 characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789` (no `I`, `L`, `O`, `U`, `0` or `1`), shown as `XXXX-XXXX`. |
| `normalize(code)` | Removes the dash; this is the value whose Argon2 verifier `StaffMfaService` stores, so a later consumer (Ticket 09) compares the code without its separator. |

The codes are returned once, in the enrollment response; only their verifiers are persisted in `staff_mfa_backup_codes`. Nothing consumes them yet. Covered by `StaffMfaThrottleTest` (shape, distinctness and normalization), `StaffMfaServiceTest` and `StaffMfaIT`.
