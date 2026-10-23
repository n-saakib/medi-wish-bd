# PasswordResetIT

Source: [PasswordResetIT.java](../../../../../../../src/test/java/bd/mediwish/auth/PasswordResetIT.java)

I1 real-HTTP/PostgreSQL reset: case-normalized request, HMAC-only row, empty/cookie-free reset, old-password refusal, both prior sessions revoked, one-use consumption, unrelated-account code preservation, notice/audit/privacy and restart without resend. The unrelated account keeps a live code across the successful reset and still consumes it after its digits fail against the already-consumed owner. Actual recovery keys, code hashes, codes and credentials are tracked.

Owns its guarded application/schema where required. Captured mail stays in memory; no test-only HTTP route or production dependency is introduced. Verification results are recorded in the Ticket 05 implementation evidence.
