# `SecurityAuditEvent.java`

Source: [`src/main/java/bd/mediwish/auth/SecurityAuditEvent.java`](../../../../../../../src/main/java/bd/mediwish/auth/SecurityAuditEvent.java)

JPA mapping for one row of `security_audit_events`: random UUID, `occurred_at`, `event_type`, nullable `subject_user_id`, `session_id` and `request_id`. Every column is non-updatable. There is no free-text column, so no code, seed, password or username can be written into an audit row.

| `Type` | Recorded by |
| --- | --- |
| `FIRST_ADMIN_PROVISIONED` | `FirstAdminProvisioningService` (no session, no request ID). |
| `MFA_ENROLLMENT_STARTED` | `StaffMfaService.startEnrollment`, with the restricted session. |
| `MFA_ENROLLMENT_ACTIVATED` | `verifyEnrollment`, with the new verified session. |
| `MFA_VERIFIED` | `verify`, with the new verified session. |
| `MFA_VERIFICATION_FAILED` | Each wrong code. |
| `MFA_ATTEMPTS_LOCKED` | The failure that locks verification. |

Rows are written only through `SecurityAuditLog`. `StaffMfaIT` asserts the column list and event order; `FirstAdminProvisioningIT` and `StaffMfaRegressionIT` count events.
