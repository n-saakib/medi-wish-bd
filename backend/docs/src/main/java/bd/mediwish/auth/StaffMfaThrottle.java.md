# `StaffMfaThrottle.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaThrottle.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaThrottle.java)

JPA mapping for one User's wrong-code counter in `staff_mfa_throttle` (Ticket 06 D3): `user_id` (primary key), `failed_count`, `window_started_at` and nullable `locked_until`. `StaffMfaService` creates it on first use and reads and changes it only under the User row lock.

| Member | Behavior |
| --- | --- |
| `isLocked(now)` | True while `locked_until` is after now. |
| `recordFailure(now, max, window, lockout)` | Starts a fresh count when a previous lock exists or the window has elapsed, then increments. Returns true and sets `locked_until = now + lockout` when the count reaches `max`. |
| `reset(now)` | Clears the count and lock after a successful verification. |

With the defaults (`max-failed-attempts: 5`, `attempt-window: PT15M`, `lockout: PT15M`) the fifth wrong code within 15 minutes locks verification for 15 minutes, and a locked User is refused even with the right code. Enrollment start is not throttled. Covered by `StaffMfaThrottleTest`, `StaffMfaServiceTest`, `StaffMfaIT` and `StaffMfaRegressionIT`.
