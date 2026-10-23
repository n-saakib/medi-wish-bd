# ProfileServiceTest

Exercises owner-only projection, validated changes, missing callers, Dhaka date boundaries, normalized no-op and stale/closing precedence, duplicate ownership and the database uniqueness fallback.

Ticket 05 pins missing-password refusal before uniqueness/mutation; email set/change/clear reauthentication with the original address/verification and submitting session passed to the facade; password-free name/DOB edits; and verification retained on normalized same-email no-ops even when an ignored password is supplied. Refused changes do not invoke cancellation/revocation. Real HTTP/PostgreSQL tests prove transaction durability, cancellation, notices and session effects.
