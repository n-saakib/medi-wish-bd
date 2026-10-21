# `StaffMfaFactor.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaFactor.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaFactor.java)

JPA mapping for a staff User's authenticator in `staff_mfa_factors`: ID, `user_id`, `status` (`PENDING`, `ACTIVE` or `REVOKED`, stored as a string), `secret_ciphertext` and `secret_nonce` from `MfaSecretCipher`, `created_at`, nullable `pending_expires_at`, `activated_at` and `revoked_at`, and `last_used_step` (starts at `-1`). The ID, owner, sealed seed and creation time are non-updatable.

| Member | Behavior |
| --- | --- |
| Constructor | A new `PENDING` factor with its pending expiry. |
| `pendingExpired(at)` | True once `pending_expires_at` is not after `at`. |
| `activate(at, step)` | Becomes `ACTIVE`, sets `activated_at`, clears the pending expiry and stores the accepted step. |
| `recordUse(step)` | Stores the step of an accepted verification code, so no code from that step or earlier is accepted again. |

`revoke(at)` requires an ACTIVE factor, changes it to REVOKED and records the time. `StaffMfaRecoveryService.verifyReplacement` is its sole production caller: it flushes revocation before activating the pending factor, preserving the immediate one-active index. A factor revoked in the database downgrades old assurance. The one-active and one-pending partial unique indexes and the status check live in the changelog. Covered by `StaffMfaServiceTest`, `StaffMfaIT` and `StaffMfaMigrationIT`.
