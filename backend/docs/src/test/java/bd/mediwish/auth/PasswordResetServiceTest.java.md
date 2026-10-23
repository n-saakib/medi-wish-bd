# Password recovery boundary tests

Source: [`PasswordResetServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/PasswordResetServiceTest.java)

Protects address counting before lookup, unknown/unverified and over-limit silence, refreshed-address recheck, shared issuer refusal, audit/mail only for admitted issues, cleanup last, and exact password hashing before a separate reset transaction even for an unknown address.

A controlled Clock advances while the User refresh completes: issuer must receive the post-lock instant, not the old request-start time. This regression failed behaviorally before the one-line service correction.

Cleanup uses the configured counter retention: a three-hour address window prunes only rows older than three hours. A failing issuer statement propagates the same exception and skips cleanup, so the root cause is not masked.
