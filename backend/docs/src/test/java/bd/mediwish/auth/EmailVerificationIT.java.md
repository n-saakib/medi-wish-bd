# EmailVerificationIT

Source: [EmailVerificationIT.java](../../../../../../../src/test/java/bd/mediwish/auth/EmailVerificationIT.java)

Real captured-code verification persists without a profile-version bump. Separate-purpose rows cannot consume each other; tests account for legitimately equal random digits and the already-verified idempotent response. A signed-in User cannot confirm with another User's code, and each token reads only its own verification state. Password-confirmed email replacement cancels the old code; no email and closing state refuse both routes; repeated verified requests issue no mail.

Owns its guarded application/schema where required. Captured mail stays in memory; no test-only HTTP route or production dependency is introduced. Verification results are recorded in the Ticket 05 implementation evidence.
