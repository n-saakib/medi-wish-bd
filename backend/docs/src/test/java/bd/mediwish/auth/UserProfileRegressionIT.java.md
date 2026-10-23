# UserProfileRegressionIT.java

Source: [UserProfileRegressionIT.java](../../../../../../../src/test/java/bd/mediwish/auth/UserProfileRegressionIT.java)

## Purpose

Ticket 11 R1 checks that profile and verified-mobile changes preserve every unrelated table and the immutable username. Runs the real API and the accepted MobileChangeService.activate verifier seam in one dedicated guarded PostgreSQL schema.

## Coverage

After registration and sign-in, fingerprints discovers every base table in the run schema through information_schema. Only users, user_mobile_changes, user_sessions, user_session_refresh_tokens, account_codes, account_code_limits, security_audit_events and databasechangelog* are excluded. Each included table contributes its row count and an MD5 of all row values sorted deterministically; the map also detects added or removed tables. Identifier quoting supports metadata names, and diagnostics expose fingerprints rather than row contents.

A full name/email/date-of-birth PUT, stage, cancel, second stage and activation must each preserve the baseline fingerprints and username. Positive profile assertions confirm that each operation really took effect, including verified contact replacement and removal of the pending row. The seeded user_roles row supplies a non-empty regression table; future Order, Product, Sale Unit and Guest Access tables are included automatically.

Tagged integration and regression. Closing the test releases its application and removes only its run-owned schema.

The email-changing fixture supplies the current password; cancellation, throttling and audit tables are now accepted profile-write effects. Every other table retains its full fingerprint.
